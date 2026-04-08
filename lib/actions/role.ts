"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth, checkAuthBasic } from "@/lib/auth-helpers";
import { invalidateRoleCache, invalidatePermissionCache } from "@/lib/redis";
import { logAudit } from "@/lib/actions/audit";
import { isSystemRole, SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";
import {
  createRoleSchema,
  updateRoleSchema,
  CreateRoleInput,
  UpdateRoleInput,
} from "@/lib/validations/role";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type RoleInfo = {
  id: string;
  name: string;
  slug: string;
  label: string;
  description: string | null;
  color: string;
  hierarchyLevel: number;
  isSystem: boolean;
  salonId: string | null;
  userCount?: number;
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
          label: rd.label,
          description: rd.description,
          color: rd.color,
          hierarchyLevel: rd.hierarchyLevel,
          isSystem: rd.isSystem,
          salonId: null,
          userCount: 0,
        })),
      };
    }

    // Count users per role for this salon
    const userCounts = await prisma.user.groupBy({
      by: ["role"],
      where: { salonId: authResult.salonId, isActive: true },
      _count: true,
    });
    const countMap = new Map(userCounts.map((uc) => [uc.role, uc._count]));

    return {
      success: true,
      data: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        label: r.label,
        description: r.description,
        color: r.color,
        hierarchyLevel: r.hierarchyLevel,
        isSystem: r.isSystem,
        salonId: r.salonId,
        userCount: countMap.get(r.name) ?? 0,
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
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { name, label, description, color, hierarchyLevel } = parsed.data;

  // Cannot create a system role name
  if (isSystemRole(name.toUpperCase())) {
    return { success: false, error: "Cannot use a system role name" };
  }

  // Hierarchy level must be below the caller's own level
  const { SYSTEM_ROLE_HIERARCHY } = await import("@/lib/roles");
  const callerLevel = SYSTEM_ROLE_HIERARCHY[authResult.role] ?? 0;
  if (!authResult.isSuperAdmin && hierarchyLevel >= callerLevel) {
    return { success: false, error: "Cannot create a role at or above your own hierarchy level" };
  }

  // Use uppercase name for DB storage
  const roleName = name.toUpperCase().replace(/ /g, "_");
  const slug = slugify(name);

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
        name: roleName,
        slug,
        label,
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
      details: { name: roleName, label, hierarchyLevel },
    });

    revalidatePath("/dashboard/settings/roles");
    revalidatePath("/dashboard/settings/permissions");

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        label: role.label,
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
  const authResult = await checkAuth("settings:manage");
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

    // Validate hierarchy level if changing
    if (updateData.hierarchyLevel !== undefined) {
      const { SYSTEM_ROLE_HIERARCHY } = await import("@/lib/roles");
      const callerLevel = SYSTEM_ROLE_HIERARCHY[authResult.role] ?? 0;
      if (!authResult.isSuperAdmin && updateData.hierarchyLevel >= callerLevel) {
        return { success: false, error: "Cannot set hierarchy level at or above your own" };
      }
    }

    await prisma.roleDefinition.update({
      where: { id },
      data: {
        ...(updateData.label !== undefined && { label: updateData.label }),
        ...(updateData.description !== undefined && { description: updateData.description || null }),
        ...(updateData.color !== undefined && { color: updateData.color }),
        ...(updateData.hierarchyLevel !== undefined && { hierarchyLevel: updateData.hierarchyLevel }),
      },
    });

    await invalidateRoleCache(authResult.salonId);

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
  const authResult = await checkAuth("settings:manage");
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

    // Check if any users are assigned this role
    const usersWithRole = await prisma.user.count({
      where: { salonId: authResult.salonId, role: existing.name },
    });
    if (usersWithRole > 0) {
      return {
        success: false,
        error: `Cannot delete: ${usersWithRole} user(s) are assigned to this role. Reassign them first.`,
      };
    }

    // Delete any role-permission assignments for this role
    await prisma.rolePermission.deleteMany({
      where: { salonId: authResult.salonId, role: existing.name },
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
      details: { name: existing.name, label: existing.label },
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
 * Seed system role definitions (called during migration/seed).
 */
export async function seedSystemRoles(): Promise<void> {
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
    await prisma.roleDefinition.upsert({
      where: { salonId_slug: { salonId: null as unknown as string, slug: def.slug } },
      update: {
        label: def.label,
        description: def.description,
        color: def.color,
        hierarchyLevel: def.hierarchyLevel,
      },
      create: {
        name: def.name,
        slug: def.slug,
        label: def.label,
        description: def.description,
        color: def.color,
        hierarchyLevel: def.hierarchyLevel,
        isSystem: true,
        salonId: null,
      },
    });
  }
}
