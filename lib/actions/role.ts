"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth, checkAuthBasic } from "@/lib/auth-helpers";
import { invalidateRoleCache, invalidatePermissionCache } from "@/lib/redis";
import { logAudit } from "@/lib/actions/audit";
import { isSystemRole, SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";
import { getOrganizationSalonIds } from "@/lib/actions/branch";
import {
  createRoleSchema,
  updateRoleSchema,
  CreateRoleInput,
  UpdateRoleInput,
} from "@/lib/validations/role";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type RoleInfo = {
  id: string;
  name: string;        // Display name (e.g., "Owner", "Senior Stylist")
  slug: string;        // Internal identifier (e.g., "owner", "senior-stylist")
  description: string | null;
  color: string;
  hierarchyLevel: number;
  isSystem: boolean;
  salonId: string | null;
  userCount?: number;       // business-wide (all branches)
  branchUserCount?: number; // current branch only
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Get all role definitions for the current salon (system + custom).
 */
export async function getRoleDefinitions(): Promise<ActionResult<RoleInfo[]>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const roles = await prisma.roleDefinition.findMany({
      where: {
        OR: [{ salonId: null, isSystem: true }, { salonId: authResult.salonId }],
        isActive: true,
      },
      orderBy: { hierarchyLevel: "desc" },
    });

    // If no role definitions exist yet (pre-migration), return system defaults
    if (roles.length === 0) {
      return {
        success: true,
        data: SYSTEM_ROLE_DEFINITIONS.map((rd) => ({
          id: rd.slug,
          name: rd.name,
          slug: rd.slug,
          description: rd.description,
          color: rd.color,
          hierarchyLevel: rd.hierarchyLevel,
          isSystem: rd.isSystem,
          salonId: null,
          userCount: 0,
        })),
      };
    }

    // Count users per role — business-wide (all branches) + current branch
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    const [orgCounts, branchCounts] = await Promise.all([
      prisma.userSalon.groupBy({
        by: ["roleDefinitionId"],
        where: { salonId: { in: orgSalonIds }, isActive: true },
        _count: true,
      }),
      prisma.userSalon.groupBy({
        by: ["roleDefinitionId"],
        where: { salonId: authResult.salonId, isActive: true },
        _count: true,
      }),
    ]);

    const orgCountMap = new Map(orgCounts.map((uc) => [uc.roleDefinitionId, uc._count]));
    const branchCountMap = new Map(branchCounts.map((uc) => [uc.roleDefinitionId, uc._count]));

    return {
      success: true,
      data: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        color: r.color,
        hierarchyLevel: r.hierarchyLevel,
        isSystem: r.isSystem,
        salonId: r.salonId,
        userCount: orgCountMap.get(r.id) ?? 0,
        branchUserCount: branchCountMap.get(r.id) ?? 0,
      })),
    };
  } catch (error) {
    console.error("Error fetching role definitions:", error);
    return { success: false, error: "Failed to load roles" };
  }
}

/**
 * Get available roles for dropdowns (no special permission needed, just authenticated).
 */
export async function getAvailableRoles(): Promise<ActionResult<RoleInfo[]>> {
  return getRoleDefinitions();
}

/**
 * Create a custom role for the current salon.
 */
export async function createRole(input: CreateRoleInput): Promise<ActionResult<RoleInfo>> {
  const authResult = await checkAuth("roles:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { name, label, description, color, hierarchyLevel } = parsed.data;

  // Cannot create a system role name
  const slug = slugify(name);

  if (isSystemRole(slug)) {
    return { success: false, error: `"${name}" matches a built-in role. Try "Senior ${name}", "Branch ${name}", or another distinct name.` };
  }

  // Hierarchy level must be below the caller's own level
  const { getHierarchyLevels } = await import("@/lib/permissions");
  const hierarchy = await getHierarchyLevels(authResult.salonId);
  const callerLevel = hierarchy[authResult.roleId] ?? 0;
  if (!authResult.isSuperAdmin && hierarchyLevel >= callerLevel) {
    return { success: false, error: "Cannot create a role at or above your own hierarchy level" };
  }

  try {
    // Check for duplicate slug in this salon
    const existing = await prisma.roleDefinition.findFirst({
      where: {
        salonId: authResult.salonId,
        slug,
      },
    });
    if (existing) {
      return { success: false, error: "A role with this name already exists" };
    }

    // Also check global system roles for slug conflicts
    const systemConflict = await prisma.roleDefinition.findFirst({
      where: {
        salonId: null,
        slug,
        isSystem: true,
      },
    });
    if (systemConflict) {
      return { success: false, error: "This name conflicts with a system role" };
    }

    const role = await prisma.roleDefinition.create({
      data: {
        name: label,  // The label field from input is the display name
        slug,
        description: description || null,
        color,
        hierarchyLevel,
        isSystem: false,
        salonId: authResult.salonId,
      },
    });

    // Invalidate caches
    await invalidateRoleCache(authResult.salonId);

    await logAudit({
      action: "ROLE_CREATED",
      entityType: "RoleDefinition",
      entityId: role.id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { name: role.name, slug, hierarchyLevel },
    });

    revalidatePath("/dashboard/settings/roles");
    revalidatePath("/dashboard/settings/permissions");

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        color: role.color,
        hierarchyLevel: role.hierarchyLevel,
        isSystem: role.isSystem,
        salonId: role.salonId,
        userCount: 0,
      },
    };
  } catch (error) {
    console.error("Error creating role:", error);
    return { success: false, error: "Failed to create role" };
  }
}

/**
 * Update a custom role (not system roles).
 */
export async function updateRole(input: UpdateRoleInput): Promise<ActionResult<null>> {
  const authResult = await checkAuth("roles:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { id, ...updateData } = parsed.data;

  try {
    const existing = await prisma.roleDefinition.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: "Role not found" };
    }

    if (existing.isSystem) {
      return { success: false, error: "Cannot edit system roles" };
    }

    if (existing.salonId !== authResult.salonId) {
      return { success: false, error: "Role not found in this salon" };
    }

    // Verify caller can manage this role (hierarchy check)
    const { canManageRole, getHierarchyLevels } = await import("@/lib/permissions");
    if (!authResult.isSuperAdmin && !(await canManageRole(authResult.roleId, existing.id, authResult.isSuperAdmin, authResult.salonId))) {
      return { success: false, error: "Not authorized to manage this role" };
    }

    // Validate hierarchy level if changing
    if (updateData.hierarchyLevel !== undefined) {
      const hierarchy = await getHierarchyLevels(authResult.salonId);
      const callerLevel = hierarchy[authResult.roleId] ?? 0;
      if (!authResult.isSuperAdmin && updateData.hierarchyLevel >= callerLevel) {
        return { success: false, error: "Cannot set hierarchy level at or above your own" };
      }
    }

    // If name is changing, compute new slug and check for conflicts
    const isRenaming = updateData.name !== undefined && updateData.name !== existing.name;
    let newSlug: string | undefined;

    if (isRenaming) {
      newSlug = slugify(updateData.name!);

      if (isSystemRole(newSlug)) {
        return { success: false, error: `"${updateData.name}" matches a built-in role. Try "Senior ${updateData.name}", "Branch ${updateData.name}", or another distinct name.` };
      }

      // Check for duplicate slug in this salon
      const duplicate = await prisma.roleDefinition.findFirst({
        where: { salonId: authResult.salonId, slug: newSlug, id: { not: id } },
      });
      if (duplicate) {
        return { success: false, error: "A role with this name already exists" };
      }
    }

    // Since UserSalon and RolePermission reference by roleDefinitionId (FK),
    // renaming only needs to update the RoleDefinition record itself.
    await prisma.roleDefinition.update({
      where: { id },
      data: {
        ...(updateData.name !== undefined && { name: updateData.name }),
        ...(isRenaming && { slug: newSlug }),
        ...(updateData.description !== undefined && { description: updateData.description || null }),
        ...(updateData.color !== undefined && { color: updateData.color }),
        ...(updateData.hierarchyLevel !== undefined && { hierarchyLevel: updateData.hierarchyLevel }),
      },
    });

    await invalidateRoleCache(authResult.salonId);
    await invalidatePermissionCache(authResult.salonId);

    await logAudit({
      action: "ROLE_UPDATED",
      entityType: "RoleDefinition",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: updateData,
    });

    revalidatePath("/dashboard/settings/roles");
    revalidatePath("/dashboard/settings/permissions");

    return { success: true, data: null };
  } catch (error) {
    console.error("Error updating role:", error);
    return { success: false, error: "Failed to update role" };
  }
}

/**
 * Delete a custom role. Prevents deletion if users are assigned to it.
 */
export async function deleteRole(id: string): Promise<ActionResult<null>> {
  const authResult = await checkAuth("roles:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existing = await prisma.roleDefinition.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: "Role not found" };
    }

    if (existing.isSystem) {
      return { success: false, error: "Cannot delete system roles" };
    }

    if (existing.salonId !== authResult.salonId) {
      return { success: false, error: "Role not found in this salon" };
    }

    // Hierarchy check: caller must outrank the role being deleted
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.roleId, existing.id, authResult.isSuperAdmin, authResult.salonId))) {
      return { success: false, error: "Not authorized to manage this role" };
    }

    // Check if any users are assigned this role (business-wide)
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    const usersWithRole = await prisma.userSalon.count({
      where: { salonId: { in: orgSalonIds }, roleDefinitionId: existing.id, isActive: true },
    });
    if (usersWithRole > 0) {
      return {
        success: false,
        error: `Cannot delete: ${usersWithRole} user(s) across your branches are assigned to this role. Reassign them first.`,
      };
    }

    // Delete any role-permission assignments for this role
    await prisma.rolePermission.deleteMany({
      where: { salonId: authResult.salonId, roleDefinitionId: existing.id },
    });

    await prisma.roleDefinition.delete({ where: { id } });

    await invalidateRoleCache(authResult.salonId);
    await invalidatePermissionCache(authResult.salonId);

    await logAudit({
      action: "ROLE_DELETED",
      entityType: "RoleDefinition",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { name: existing.name, slug: existing.slug },
    });

    revalidatePath("/dashboard/settings/roles");
    revalidatePath("/dashboard/settings/permissions");

    return { success: true, data: null };
  } catch (error) {
    console.error("Error deleting role:", error);
    return { success: false, error: "Failed to delete role" };
  }
}

/**
 * Get a single role by slug, along with all permissions and which are granted.
 */
export async function getRoleBySlug(slug: string): Promise<
  ActionResult<{
    role: RoleInfo;
    permissions: Array<{
      code: string;
      module: string;
      label: string;
      description: string | null;
      sortOrder: number;
    }>;
    grantedPermissions: string[];
    callerHierarchyLevel: number;
  }>
> {
  const authResult = await checkAuth("permissions:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Look up role: system roles have salonId=null, custom roles have salonId=current
    const roleDef = await prisma.roleDefinition.findFirst({
      where: {
        slug,
        OR: [{ salonId: null, isSystem: true }, { salonId: authResult.salonId }],
        isActive: true,
      },
    });

    // Fallback to system defaults if no DB record
    if (!roleDef) {
      const systemDef = SYSTEM_ROLE_DEFINITIONS.find((rd) => rd.slug === slug);
      if (!systemDef) {
        return { success: false, error: "Role not found" };
      }

      // Get all permissions
      const permissions = await prisma.permission.findMany({
        orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
      });

      // Use default permission mapping
      const { DEFAULT_PERMISSION_ROLES } = await import("@/lib/permissions-defaults");
      const grantedPermissions = Object.entries(DEFAULT_PERMISSION_ROLES)
        .filter(([, roles]) => roles.includes(systemDef.name))
        .map(([code]) => code);

      const { getHierarchyLevels } = await import("@/lib/permissions");
      const hierarchy = await getHierarchyLevels(authResult.salonId);
      const callerHierarchyLevel = authResult.isSuperAdmin
        ? 999
        : (hierarchy[authResult.roleId] ?? 0);

      return {
        success: true,
        data: {
          role: {
            id: systemDef.slug,
            name: systemDef.name,
            slug: systemDef.slug,
            description: systemDef.description,
            color: systemDef.color,
            hierarchyLevel: systemDef.hierarchyLevel,
            isSystem: systemDef.isSystem,
            salonId: null,
          },
          permissions: permissions.map((p) => ({
            code: p.code,
            module: p.module,
            label: p.label,
            description: p.description,
            sortOrder: p.sortOrder,
          })),
          grantedPermissions,
          callerHierarchyLevel,
        },
      };
    }

    // Get all permissions
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    });

    // Get granted permissions for this role at this salon
    const rolePermissions = await prisma.rolePermission.findMany({
      where: { salonId: authResult.salonId, roleDefinitionId: roleDef.id },
      include: { permission: { select: { code: true } } },
    });

    let grantedPermissions: string[];
    if (rolePermissions.length === 0) {
      // Check if salon is provisioned at all
      const salonHasAnyPerms = await prisma.rolePermission.count({
        where: { salonId: authResult.salonId },
      });
      if (salonHasAnyPerms === 0) {
        // Fall back to defaults
        const { DEFAULT_PERMISSION_ROLES } = await import("@/lib/permissions-defaults");
        grantedPermissions = Object.entries(DEFAULT_PERMISSION_ROLES)
          .filter(([, roles]) => roles.includes(roleDef.slug))
          .map(([code]) => code);
      } else {
        grantedPermissions = [];
      }
    } else {
      grantedPermissions = rolePermissions.map((rp) => rp.permission.code);
    }

    // Caller hierarchy level
    const { getHierarchyLevels } = await import("@/lib/permissions");
    const hierarchy = await getHierarchyLevels(authResult.salonId);
    const callerHierarchyLevel = authResult.isSuperAdmin
      ? 999
      : (hierarchy[authResult.roleId] ?? 0);

    return {
      success: true,
      data: {
        role: {
          id: roleDef.id,
          name: roleDef.name,
          slug: roleDef.slug,
          description: roleDef.description,
          color: roleDef.color,
          hierarchyLevel: roleDef.hierarchyLevel,
          isSystem: roleDef.isSystem,
          salonId: roleDef.salonId,
        },
        permissions: permissions.map((p) => ({
          code: p.code,
          module: p.module,
          label: p.label,
          description: p.description,
          sortOrder: p.sortOrder,
        })),
        grantedPermissions,
        callerHierarchyLevel,
      },
    };
  } catch (error) {
    console.error("Error fetching role by slug:", error);
    return { success: false, error: "Failed to load role" };
  }
}

/**
 * Seed system role definitions (called during migration/seed).
 */
export async function seedSystemRoles(): Promise<void> {
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
    await prisma.roleDefinition.upsert({
      where: { salonId_slug: { salonId: null as unknown as string, slug: def.slug } },
      update: {
        name: def.name,
        description: def.description,
        color: def.color,
        hierarchyLevel: def.hierarchyLevel,
      },
      create: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        color: def.color,
        hierarchyLevel: def.hierarchyLevel,
        isSystem: true,
        salonId: null,
      },
    });
  }
}
