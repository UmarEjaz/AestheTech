"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth, checkAuthBasic } from "@/lib/auth-helpers";
import { invalidateRoleCache, invalidatePermissionCache } from "@/lib/redis";
import { logAudit } from "@/lib/actions/audit";
import { SYSTEM_ROLE_DEFINITIONS, SYSTEM_ROLES } from "@/lib/roles";
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

  const { name, description, color, hierarchyLevel } = parsed.data;

  // Single source of truth: the slug is derived from the same value that gets stored
  // as the display name. No second input field can drift away from the slug.
  const slug = slugify(name);

  if (slug === SYSTEM_ROLES.OWNER) {
    return { success: false, error: `"${name}" is reserved for the system Owner role.` };
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

    // Belt-and-suspenders: reject case-insensitive duplicates of the display name in the
    // same salon. Catches whitespace/casing variants the slugifier might not normalize.
    const nameClash = await prisma.roleDefinition.findFirst({
      where: {
        salonId: authResult.salonId,
        name: { equals: name, mode: "insensitive" },
      },
    });
    if (nameClash) {
      return { success: false, error: "A role with this display name already exists in this salon" };
    }

    const role = await prisma.roleDefinition.create({
      data: {
        name,
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

      if (newSlug === SYSTEM_ROLES.OWNER) {
        return { success: false, error: `"${updateData.name}" is reserved for the system Owner role.` };
      }

      // Check for duplicate slug in this salon
      const duplicate = await prisma.roleDefinition.findFirst({
        where: { salonId: authResult.salonId, slug: newSlug, id: { not: id } },
      });
      if (duplicate) {
        return { success: false, error: "A role with this name already exists" };
      }

      // Belt-and-suspenders: reject case-insensitive duplicates of the display name in
      // the same salon (other than the role itself).
      const nameClash = await prisma.roleDefinition.findFirst({
        where: {
          salonId: authResult.salonId,
          name: { equals: updateData.name!, mode: "insensitive" },
          id: { not: id },
        },
      });
      if (nameClash) {
        return { success: false, error: "A role with this display name already exists in this salon" };
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

    // Delete role-permission assignments and the role itself atomically. Without the
    // transaction, a failure between the two operations would leave the role row in place
    // with no permissions — an orphaned half-state.
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { salonId: authResult.salonId, roleDefinitionId: existing.id },
      });
      await tx.roleDefinition.delete({ where: { id } });
    });

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
    let roleDef = await prisma.roleDefinition.findFirst({
      where: {
        slug,
        OR: [{ salonId: null, isSystem: true }, { salonId: authResult.salonId }],
        isActive: true,
      },
    });

    // Self-heal: if a known system role is missing from the DB (incomplete seed),
    // create it on demand so downstream callers receive a real DB ID instead of a slug stand-in.
    // Prisma doesn't support `null` in a composite-unique `where` clause (the cast was a TS
    // workaround, not a runtime fix), so do an explicit find-then-create instead.
    if (!roleDef) {
      const systemDef = SYSTEM_ROLE_DEFINITIONS.find((rd) => rd.slug === slug);
      if (!systemDef) {
        return { success: false, error: "Role not found" };
      }
      const existing = await prisma.roleDefinition.findFirst({
        where: { salonId: null, slug: systemDef.slug },
      });
      if (existing) {
        roleDef = existing;
      } else {
        // Race-safe create: a concurrent self-heal can win the create between our
        // findFirst and our create. The partial unique index on (slug WHERE salonId IS
        // NULL) makes the second create fail with P2002; we recover by re-querying
        // for the row the winner just inserted.
        try {
          roleDef = await prisma.roleDefinition.create({
            data: {
              name: systemDef.name,
              slug: systemDef.slug,
              description: systemDef.description,
              color: systemDef.color,
              hierarchyLevel: systemDef.hierarchyLevel,
              isSystem: true,
              salonId: null,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            const winner = await prisma.roleDefinition.findFirst({
              where: { salonId: null, slug: systemDef.slug },
            });
            if (!winner) {
              return { success: false, error: "Role not found" };
            }
            roleDef = winner;
          } else {
            throw err;
          }
        }
      }
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
 * Seed the Owner system role globally (salonId=null, isSystem=true).
 * Owner is the only permanently-locked role — it cannot be edited, deleted, or
 * deactivated. Every other default role (Admin, Staff, Receptionist) is seeded
 * per-salon as a regular customizable role via `seedDefaultSalonRoles`.
 */
export async function seedSystemRoles(): Promise<void> {
  const ownerDef = SYSTEM_ROLE_DEFINITIONS.find((rd) => rd.slug === SYSTEM_ROLES.OWNER);
  if (!ownerDef) {
    throw new Error(`Owner role definition missing from SYSTEM_ROLE_DEFINITIONS`);
  }
  // Prisma doesn't support `null` in a composite-unique `where` clause for upsert,
  // so do an explicit find-then-update-or-create instead.
  const existingOwner = await prisma.roleDefinition.findFirst({
    where: { salonId: null, slug: ownerDef.slug },
  });
  if (existingOwner) {
    await prisma.roleDefinition.update({
      where: { id: existingOwner.id },
      data: {
        name: ownerDef.name,
        description: ownerDef.description,
        color: ownerDef.color,
        hierarchyLevel: ownerDef.hierarchyLevel,
      },
    });
  } else {
    // Race-safe create: a concurrent seed run can win between our findFirst and
    // our create. The partial unique index on (slug WHERE salonId IS NULL) makes
    // the second create fail with P2002. Swallow that — the winning row is
    // already what we wanted to insert, so there's nothing more to do here.
    try {
      await prisma.roleDefinition.create({
        data: {
          name: ownerDef.name,
          slug: ownerDef.slug,
          description: ownerDef.description,
          color: ownerDef.color,
          hierarchyLevel: ownerDef.hierarchyLevel,
          isSystem: true,
          salonId: null,
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
    }
  }
}

/**
 * Seed per-salon copies of Admin, Staff, and Receptionist as regular (non-system) roles.
 * Called whenever a new salon/branch is created. These roles are fully editable and
 * deletable by salon admins — they're just convenient starter templates.
 *
 * Uses upsert + a transaction client so callers can pass in a Prisma transaction.
 */
export async function seedDefaultSalonRoles(
  salonId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? prisma;
  const defaultRoleSlugs = [SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.STAFF, SYSTEM_ROLES.RECEPTIONIST];
  for (const slug of defaultRoleSlugs) {
    const def = SYSTEM_ROLE_DEFINITIONS.find((rd) => rd.slug === slug);
    if (!def) continue;
    await client.roleDefinition.upsert({
      where: { salonId_slug: { salonId, slug: def.slug } },
      update: {},
      create: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        color: def.color,
        hierarchyLevel: def.hierarchyLevel,
        isSystem: false,
        salonId,
      },
    });
  }
}
