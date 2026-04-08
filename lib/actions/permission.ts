"use server";

import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { invalidatePermissionCache, invalidateUserPermissionCache } from "@/lib/redis";
import { logAudit } from "@/lib/actions/audit";
import {
  permissionUpdateSchema,
  PermissionUpdateInput,
  userPermissionUpdateSchema,
  UserPermissionUpdateInput,
} from "@/lib/validations/permission";
import {
  DEFAULT_PERMISSION_ROLES,
  OWNER_LOCKED_PERMISSIONS,
  OWNER_ROLE_NAME,
} from "@/lib/permissions-defaults";
import { SYSTEM_ROLES, SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface PermissionMatrixData {
  permissions: Array<{
    code: string;
    module: string;
    label: string;
    description: string | null;
    sortOrder: number;
  }>;
  assignments: Record<string, string[]>; // permCode -> role names
  roles: Array<{ name: string; label: string; color: string; isSystem: boolean }>;
}

/**
 * Get the full permission matrix for the current salon.
 */
export async function getPermissionMatrix(): Promise<ActionResult<PermissionMatrixData>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Get all permissions
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    });

    // Get current role-permission assignments for this salon
    const rolePermissions = await prisma.rolePermission.findMany({
      where: { salonId: authResult.salonId },
      include: { permission: { select: { code: true } } },
    });

    // Build assignments map: permCode -> [roles]
    const assignments: Record<string, string[]> = {};
    for (const rp of rolePermissions) {
      const code = rp.permission.code;
      if (!assignments[code]) assignments[code] = [];
      assignments[code].push(rp.role);
    }

    // If no assignments exist (salon not provisioned), use defaults
    if (rolePermissions.length === 0) {
      for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
        assignments[code] = [...roles];
      }
    }

    // Get role definitions: system + salon custom roles
    const roleDefs = await prisma.roleDefinition.findMany({
      where: {
        OR: [{ salonId: null, isSystem: true }, { salonId: authResult.salonId }],
        isActive: true,
      },
      orderBy: { hierarchyLevel: "desc" },
      select: { name: true, label: true, color: true, isSystem: true },
    });

    // Fallback if no role definitions exist yet
    const roles = roleDefs.length > 0
      ? roleDefs.map((r) => ({ name: r.name, label: r.label, color: r.color, isSystem: r.isSystem }))
      : SYSTEM_ROLE_DEFINITIONS.map((r) => ({ name: r.name, label: r.label, color: r.color, isSystem: r.isSystem }));

    return {
      success: true,
      data: {
        permissions: permissions.map((p) => ({
          code: p.code,
          module: p.module,
          label: p.label,
          description: p.description,
          sortOrder: p.sortOrder,
        })),
        assignments,
        roles,
      },
    };
  } catch (error) {
    console.error("Error fetching permission matrix:", error);
    return { success: false, error: "Failed to load permissions" };
  }
}

/**
 * Update role-permission assignments for the current salon.
 */
export async function updatePermissions(
  input: PermissionUpdateInput
): Promise<ActionResult<null>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input
  const parsed = permissionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { assignments } = parsed.data;

  // Enforce owner lockout protection
  const ownerRevocations = assignments.filter(
    (a) => a.role === OWNER_ROLE_NAME && !a.granted && OWNER_LOCKED_PERMISSIONS.includes(a.permissionCode)
  );
  if (ownerRevocations.length > 0) {
    return {
      success: false,
      error: `Cannot remove critical permissions from Owner: ${ownerRevocations.map((a) => a.permissionCode).join(", ")}`,
    };
  }

  try {
    // Get permission ID lookup
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    // Separate grants and revocations
    const toGrant = assignments.filter((a) => a.granted);
    const toRevoke = assignments.filter((a) => !a.granted);

    await prisma.$transaction(async (tx) => {
      // Process revocations
      for (const revoke of toRevoke) {
        const permId = permIdMap.get(revoke.permissionCode);
        if (!permId) continue;
        await tx.rolePermission.deleteMany({
          where: {
            salonId: authResult.salonId,
            role: revoke.role,
            permissionId: permId,
          },
        });
      }

      // Process grants (upsert to avoid duplicates)
      for (const grant of toGrant) {
        const permId = permIdMap.get(grant.permissionCode);
        if (!permId) continue;
        await tx.rolePermission.upsert({
          where: {
            salonId_role_permissionId: {
              salonId: authResult.salonId,
              role: grant.role,
              permissionId: permId,
            },
          },
          update: {},
          create: {
            salonId: authResult.salonId,
            role: grant.role,
            permissionId: permId,
          },
        });
      }
    });

    // Invalidate cache
    await invalidatePermissionCache(authResult.salonId);

    // Audit log
    await logAudit({
      action: "PERMISSIONS_UPDATED",
      entityType: "Permission",
      entityId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: {
        changes: assignments.length,
        grants: toGrant.length,
        revocations: toRevoke.length,
      },
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error updating permissions:", error);
    return { success: false, error: "Failed to update permissions" };
  }
}

/**
 * Reset all permissions for the current salon to defaults.
 */
export async function resetPermissionsToDefaults(): Promise<ActionResult<null>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    await prisma.$transaction(async (tx) => {
      // Delete all current assignments for this salon
      await tx.rolePermission.deleteMany({
        where: { salonId: authResult.salonId },
      });

      // Re-create defaults
      const data: Array<{ salonId: string; role: string; permissionId: string }> = [];
      for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
        const permId = permIdMap.get(code);
        if (!permId) continue;
        for (const role of roles) {
          data.push({ salonId: authResult.salonId, role, permissionId: permId });
        }
      }
      await tx.rolePermission.createMany({ data });
    });

    // Invalidate cache
    await invalidatePermissionCache(authResult.salonId);

    // Audit log
    await logAudit({
      action: "PERMISSIONS_RESET",
      entityType: "Permission",
      entityId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error resetting permissions:", error);
    return { success: false, error: "Failed to reset permissions" };
  }
}

/**
 * Seed default permissions for a newly created salon.
 * Called from salon/branch creation actions.
 */
export async function seedPermissionsForSalon(salonId: string): Promise<void> {
  const allPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

  const data: Array<{ salonId: string; role: string; permissionId: string }> = [];
  for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
    const permId = permIdMap.get(code);
    if (!permId) continue;
    for (const role of roles) {
      data.push({ salonId, role, permissionId: permId });
    }
  }

  await prisma.rolePermission.createMany({ data, skipDuplicates: true });
}

// ============================================
// User-Level Permission Overrides
// ============================================

export interface UserPermissionOverrideData {
  permissions: Array<{
    code: string;
    module: string;
    label: string;
    description: string | null;
    sortOrder: number;
  }>;
  rolePermissions: string[]; // permission codes the user's role grants
  overrides: Record<string, "GRANT" | "REVOKE">; // permCode -> overrideType
  targetUser: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

/**
 * Get current user-level permission overrides for a specific user.
 */
export async function getUserPermissionOverrides(
  targetUserId: string
): Promise<ActionResult<UserPermissionOverrideData>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify the target user belongs to this salon
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, firstName: true, lastName: true, role: true, salonId: true },
    });

    if (!targetUser || targetUser.salonId !== authResult.salonId) {
      return { success: false, error: "User not found in this salon" };
    }

    // Get all permissions
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    });

    // Get role-level permissions for this user's role
    const rolePerms = await prisma.rolePermission.findMany({
      where: { salonId: authResult.salonId, role: targetUser.role },
      include: { permission: { select: { code: true } } },
    });

    let rolePermCodes: string[];
    if (rolePerms.length === 0) {
      // Fall back to defaults
      rolePermCodes = Object.entries(DEFAULT_PERMISSION_ROLES)
        .filter(([, roles]) => roles.includes(targetUser.role))
        .map(([code]) => code);
    } else {
      rolePermCodes = rolePerms.map((rp) => rp.permission.code);
    }

    // Get existing user overrides
    const userPerms = await prisma.userPermission.findMany({
      where: { salonId: authResult.salonId, userId: targetUserId },
      include: { permission: { select: { code: true } } },
    });

    const overrides: Record<string, "GRANT" | "REVOKE"> = {};
    for (const up of userPerms) {
      overrides[up.permission.code] = up.overrideType as "GRANT" | "REVOKE";
    }

    return {
      success: true,
      data: {
        permissions: permissions.map((p) => ({
          code: p.code,
          module: p.module,
          label: p.label,
          description: p.description,
          sortOrder: p.sortOrder,
        })),
        rolePermissions: rolePermCodes,
        overrides,
        targetUser: {
          id: targetUser.id,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          role: targetUser.role,
        },
      },
    };
  } catch (error) {
    console.error("Error fetching user permission overrides:", error);
    return { success: false, error: "Failed to load user permissions" };
  }
}

/**
 * Update user-level permission overrides for a specific user.
 * Replaces all existing overrides with the new set.
 */
export async function updateUserPermissions(
  input: UserPermissionUpdateInput
): Promise<ActionResult<null>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input
  const parsed = userPermissionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { userId: targetUserId, overrides } = parsed.data;

  try {
    // Verify target user belongs to this salon
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, salonId: true },
    });

    if (!targetUser || targetUser.salonId !== authResult.salonId) {
      return { success: false, error: "User not found in this salon" };
    }

    // Enforce role hierarchy: you can only set overrides on users you can manage
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.role, targetUser.role, authResult.isSuperAdmin, authResult.salonId))) {
      return { success: false, error: "You cannot modify permissions for this user" };
    }

    // Enforce owner lockout: cannot REVOKE critical permissions from OWNER users
    if (targetUser.role === OWNER_ROLE_NAME) {
      const ownerRevocations = overrides.filter(
        (o) => o.overrideType === "REVOKE" && OWNER_LOCKED_PERMISSIONS.includes(o.permissionCode)
      );
      if (ownerRevocations.length > 0) {
        return {
          success: false,
          error: `Cannot revoke critical permissions from Owner: ${ownerRevocations.map((o) => o.permissionCode).join(", ")}`,
        };
      }
    }

    // Get permission ID lookup
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    await prisma.$transaction(async (tx) => {
      // Delete all existing overrides for this user+salon
      await tx.userPermission.deleteMany({
        where: { salonId: authResult.salonId, userId: targetUserId },
      });

      // Create new overrides
      if (overrides.length > 0) {
        const data = overrides
          .map((o) => {
            const permId = permIdMap.get(o.permissionCode);
            if (!permId) return null;
            return {
              salonId: authResult.salonId,
              userId: targetUserId,
              permissionId: permId,
              overrideType: o.overrideType as "GRANT" | "REVOKE",
            };
          })
          .filter((d): d is NonNullable<typeof d> => d !== null);

        if (data.length > 0) {
          await tx.userPermission.createMany({ data });
        }
      }
    });

    // Invalidate user permission cache
    await invalidateUserPermissionCache(authResult.salonId, targetUserId);

    // Audit log
    await logAudit({
      action: "USER_PERMISSIONS_UPDATED",
      entityType: "UserPermission",
      entityId: targetUserId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: {
        targetUserId,
        grants: overrides.filter((o) => o.overrideType === "GRANT").length,
        revocations: overrides.filter((o) => o.overrideType === "REVOKE").length,
      },
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error updating user permissions:", error);
    return { success: false, error: "Failed to update user permissions" };
  }
}

/**
 * Clear all user-level permission overrides for a specific user.
 */
export async function clearUserPermissionOverrides(
  targetUserId: string
): Promise<ActionResult<null>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify target user belongs to this salon
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, salonId: true },
    });

    if (!targetUser || targetUser.salonId !== authResult.salonId) {
      return { success: false, error: "User not found in this salon" };
    }

    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.role, targetUser.role, authResult.isSuperAdmin, authResult.salonId))) {
      return { success: false, error: "You cannot modify permissions for this user" };
    }

    await prisma.userPermission.deleteMany({
      where: { salonId: authResult.salonId, userId: targetUserId },
    });

    await invalidateUserPermissionCache(authResult.salonId, targetUserId);

    await logAudit({
      action: "USER_PERMISSIONS_CLEARED",
      entityType: "UserPermission",
      entityId: targetUserId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error clearing user permissions:", error);
    return { success: false, error: "Failed to clear user permissions" };
  }
}
