"use server";

import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { invalidatePermissionCache, invalidateUserPermissionCache } from "@/lib/redis";
import { logAudit } from "@/lib/actions/audit";
import {
  userPermissionUpdateSchema,
  UserPermissionUpdateInput,
  rolePermissionUpdateSchema,
} from "@/lib/validations/permission";
import { DEFAULT_PERMISSION_ROLES } from "@/lib/permissions-defaults";
import { SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface PermissionMatrixData {
  permissions: Array<{
    code: string;
    module: string;
    label: string;
    description: string | null;
    sortOrder: number;
  }>;
  assignments: Record<string, string[]>; // permCode -> role slugs
  roles: Array<{ name: string; slug: string; color: string; isSystem: boolean; hierarchyLevel: number }>;
  callerHierarchyLevel: number;
}

/**
 * Get the full permission matrix for the current salon.
 */
export async function getPermissionMatrix(): Promise<ActionResult<PermissionMatrixData>> {
  const authResult = await checkAuth("permissions:manage");
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
      include: {
        permission: { select: { code: true } },
        roleDefinition: { select: { slug: true } },
      },
    });

    // Build assignments map: permCode -> [role slugs]
    const assignments: Record<string, string[]> = {};
    for (const rp of rolePermissions) {
      const code = rp.permission.code;
      if (!assignments[code]) assignments[code] = [];
      assignments[code].push(rp.roleDefinition.slug);
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
      select: { name: true, slug: true, color: true, isSystem: true, hierarchyLevel: true },
    });

    // Fallback if no role definitions exist yet
    const roles = roleDefs.length > 0
      ? roleDefs.map((r) => ({ name: r.name, slug: r.slug, color: r.color, isSystem: r.isSystem, hierarchyLevel: r.hierarchyLevel }))
      : SYSTEM_ROLE_DEFINITIONS.map((r) => ({ name: r.name, slug: r.slug, color: r.color, isSystem: r.isSystem, hierarchyLevel: r.hierarchyLevel }));

    // Determine caller's hierarchy level
    const { getHierarchyLevels } = await import("@/lib/permissions");
    const hierarchy = await getHierarchyLevels(authResult.salonId);
    const callerHierarchyLevel = authResult.isSuperAdmin ? Infinity : (hierarchy[authResult.roleId] ?? 0);

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
        callerHierarchyLevel: authResult.isSuperAdmin ? 999 : callerHierarchyLevel,
      },
    };
  } catch (error) {
    console.error("Error fetching permission matrix:", error);
    return { success: false, error: "Failed to load permissions" };
  }
}

/**
 * Update permissions for a single role (grant/revoke specific permissions).
 */
export async function updateRolePermissions(input: {
  roleDefinitionId: string;
  grants: string[];
  revokes: string[];
}): Promise<ActionResult<null>> {
  const authResult = await checkAuth("permissions:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input shape
  const parsed = rolePermissionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const { roleDefinitionId, grants, revokes } = parsed.data;

  try {
    // Look up by ID and scope-check at the same time: caller may only target system roles
    // or roles owned by their salon.
    const roleDef = await prisma.roleDefinition.findFirst({
      where: {
        id: roleDefinitionId,
        OR: [{ isSystem: true }, { salonId: authResult.salonId }],
      },
      select: { id: true, slug: true, name: true },
    });
    if (!roleDef) {
      return { success: false, error: "Role not found" };
    }

    // Enforce hierarchy: caller can only modify permissions for roles below their level
    if (!authResult.isSuperAdmin) {
      const { getHierarchyLevels } = await import("@/lib/permissions");
      const hierarchy = await getHierarchyLevels(authResult.salonId);
      const callerLevel = hierarchy[authResult.roleId] ?? 0;
      const targetLevel = hierarchy[roleDef.id] ?? 0;
      if (targetLevel >= callerLevel) {
        return {
          success: false,
          error: `You cannot modify permissions for the "${roleDef.name}" role`,
        };
      }
    }

    // Get permission ID lookup
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    // Validate all permission codes exist
    const invalidCodes = [...grants, ...revokes].filter((code) => !permIdMap.has(code));
    if (invalidCodes.length > 0) {
      return { success: false, error: `Unknown permission codes: ${invalidCodes.join(", ")}` };
    }

    // Precompute the per-module view prefixes once. Used inside the transaction below
    // to validate that no non-`:view` permission ends up granted without its `:view`.
    const allCodes = allPermissions.map((p) => p.code);
    const viewPrefixes = new Set<string>();
    for (const code of allCodes) {
      if (code.endsWith(":view")) {
        viewPrefixes.add(code.slice(0, -":view".length));
      }
    }

    // Wrap everything in a single transaction:
    //   1. If this role has no persisted permission rows yet, materialize the fallback
    //      defaults into the DB. Without this, the first revoke of a default permission
    //      would be a no-op (nothing to delete) and the view-check would run on an empty
    //      set instead of the inherited defaults.
    //   2. Apply revokes and grants.
    //   3. Read back the resulting set and validate view dependencies. If anything fails,
    //      throw — the transaction rolls back so no partial state survives.
    let viewViolations: string[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        const currentCount = await tx.rolePermission.count({
          where: {
            salonId: authResult.salonId,
            roleDefinitionId: roleDef.id,
          },
        });

        if (currentCount === 0) {
          // Materialize the fallback defaults from DEFAULT_PERMISSION_ROLES (keyed by slug).
          const defaultRows = Object.entries(DEFAULT_PERMISSION_ROLES)
            .filter(([, roles]) => roles.includes(roleDef.slug))
            .map(([code]) => permIdMap.get(code))
            .filter((permId): permId is string => Boolean(permId))
            .map((permId) => ({
              salonId: authResult.salonId,
              roleDefinitionId: roleDef.id,
              permissionId: permId,
            }));
          if (defaultRows.length > 0) {
            await tx.rolePermission.createMany({ data: defaultRows, skipDuplicates: true });
          }
        }

        // Revocations
        for (const code of revokes) {
          const permId = permIdMap.get(code);
          if (!permId) continue;
          await tx.rolePermission.deleteMany({
            where: {
              salonId: authResult.salonId,
              roleDefinitionId: roleDef.id,
              permissionId: permId,
            },
          });
        }

        // Grants (upsert to tolerate already-present rows from the materialization step)
        for (const code of grants) {
          const permId = permIdMap.get(code);
          if (!permId) continue;
          await tx.rolePermission.upsert({
            where: {
              salonId_roleDefinitionId_permissionId: {
                salonId: authResult.salonId,
                roleDefinitionId: roleDef.id,
                permissionId: permId,
              },
            },
            update: {},
            create: {
              salonId: authResult.salonId,
              roleDefinitionId: roleDef.id,
              permissionId: permId,
            },
          });
        }

        // View-dependency check on the materialized post-edit set
        const finalRows = await tx.rolePermission.findMany({
          where: {
            salonId: authResult.salonId,
            roleDefinitionId: roleDef.id,
          },
          select: { permission: { select: { code: true } } },
        });
        const finalCodes = new Set(finalRows.map((rp) => rp.permission.code));

        const violations: string[] = [];
        for (const prefix of viewPrefixes) {
          const viewCode = `${prefix}:view`;
          if (finalCodes.has(viewCode)) continue;
          const hasNonView = allCodes.some(
            (code) =>
              code.startsWith(`${prefix}:`) &&
              code !== viewCode &&
              finalCodes.has(code)
          );
          if (hasNonView) violations.push(prefix);
        }
        if (violations.length > 0) {
          viewViolations = violations;
          // Abort the transaction — everything (materialize + revokes + grants) rolls back.
          throw new Error("VIEW_VIOLATION");
        }
      });
    } catch (err) {
      if (err instanceof Error && err.message === "VIEW_VIOLATION") {
        return {
          success: false,
          error: `View permission is required for: ${viewViolations.join(", ")}`,
        };
      }
      throw err;
    }

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
        targetRoleId: roleDef.id,
        targetRoleSlug: roleDef.slug,
        grants: grants.length,
        revocations: revokes.length,
      },
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error updating role permissions:", error);
    return { success: false, error: "Failed to update permissions" };
  }
}

/**
 * Reset permissions to defaults for a single role at the current salon.
 */
export async function resetRolePermissionsToDefaults(roleDefinitionId: string): Promise<ActionResult<null>> {
  const authResult = await checkAuth("permissions:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Look up by ID and scope-check: caller may only target system roles or roles owned
    // by their salon. The slug is still needed to filter DEFAULT_PERMISSION_ROLES below.
    const roleDef = await prisma.roleDefinition.findFirst({
      where: {
        id: roleDefinitionId,
        OR: [{ isSystem: true }, { salonId: authResult.salonId }],
      },
      select: { id: true, slug: true, name: true },
    });
    if (!roleDef) {
      return { success: false, error: "Role not found" };
    }

    // Hierarchy check
    if (!authResult.isSuperAdmin) {
      const { getHierarchyLevels } = await import("@/lib/permissions");
      const hierarchy = await getHierarchyLevels(authResult.salonId);
      const callerLevel = hierarchy[authResult.roleId] ?? 0;
      const targetLevel = hierarchy[roleDef.id] ?? 0;
      if (targetLevel >= callerLevel) {
        return {
          success: false,
          error: `You cannot modify permissions for the "${roleDef.name}" role`,
        };
      }
    }

    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    await prisma.$transaction(async (tx) => {
      // Delete all current assignments for this role at this salon
      await tx.rolePermission.deleteMany({
        where: { salonId: authResult.salonId, roleDefinitionId: roleDef.id },
      });

      // Re-create defaults for this role. DEFAULT_PERMISSION_ROLES is keyed by slug,
      // so we still need roleDef.slug here even though the public API now takes an ID.
      const data: Array<{ salonId: string; roleDefinitionId: string; permissionId: string }> = [];
      for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
        if (!roles.includes(roleDef.slug)) continue;
        const permId = permIdMap.get(code);
        if (!permId) continue;
        data.push({ salonId: authResult.salonId, roleDefinitionId: roleDef.id, permissionId: permId });
      }
      if (data.length > 0) {
        await tx.rolePermission.createMany({ data });
      }
    });

    await invalidatePermissionCache(authResult.salonId);

    await logAudit({
      action: "PERMISSIONS_RESET",
      entityType: "Permission",
      entityId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { targetRoleId: roleDef.id, targetRoleSlug: roleDef.slug },
    });

    return { success: true, data: null };
  } catch (error) {
    console.error("Error resetting role permissions:", error);
    return { success: false, error: "Failed to reset permissions" };
  }
}

/**
 * Seed default permissions for a newly created salon.
 * Internal only — NOT exported, so it cannot be called from the browser.
 * Use `seedPermissionsForSalonInternal` from other server action files via direct import.
 */

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
  const authResult = await checkAuth("permissions:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify the target user belongs to this salon via UserSalon
    const membership = await prisma.userSalon.findUnique({
      where: { userId_salonId: { userId: targetUserId, salonId: authResult.salonId } },
      select: {
        roleDefinitionId: true,
        isActive: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        roleDefinition: { select: { slug: true, id: true } },
      },
    });

    if (!membership || !membership.isActive) {
      return { success: false, error: "User not found in this salon" };
    }

    // Hierarchy guard: same check applied by updateUserPermissions/clearUserPermissionOverrides.
    // The read path needs it too so a caller can't peek at override state for higher-level users.
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(
      authResult.roleId,
      membership.roleDefinitionId,
      authResult.isSuperAdmin,
      authResult.salonId
    ))) {
      return { success: false, error: "You cannot view permissions for this user" };
    }

    const targetUser = { ...membership.user, role: membership.roleDefinition.slug };

    // Get all permissions
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    });

    // Get role-level permissions for this user's role
    const rolePerms = await prisma.rolePermission.findMany({
      where: { salonId: authResult.salonId, roleDefinitionId: membership.roleDefinitionId },
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
  const authResult = await checkAuth("permissions:manage");
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
    // Verify target user belongs to this salon via UserSalon
    const membership = await prisma.userSalon.findUnique({
      where: { userId_salonId: { userId: targetUserId, salonId: authResult.salonId } },
      select: {
        roleDefinitionId: true,
        isActive: true,
        roleDefinition: { select: { name: true } },
      },
    });

    if (!membership || !membership.isActive) {
      return { success: false, error: "User not found in this salon" };
    }

    // Enforce role hierarchy: you can only set overrides on users you can manage
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.roleId, membership.roleDefinitionId, authResult.isSuperAdmin, authResult.salonId))) {
      return { success: false, error: "You cannot modify permissions for this user" };
    }

    // Get permission ID lookup
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, code: true },
    });
    const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

    // Validate all permission codes exist
    const invalidCodes = overrides
      .map((o) => o.permissionCode)
      .filter((code) => !permIdMap.has(code));
    if (invalidCodes.length > 0) {
      return { success: false, error: `Unknown permission codes: ${invalidCodes.join(", ")}` };
    }

    // View-dependency check (defense-in-depth — mirrors client validateViewDependencies).
    // Compute the effective permission set for this user (role permissions + new overrides),
    // then ensure that for every module group that has a :view permission, view is effectively
    // granted whenever any non-view permission for that module is effectively granted.
    const { getPermissionSet } = await import("@/lib/permissions");
    const rolePerms = await getPermissionSet(authResult.salonId, membership.roleDefinitionId);
    const effectiveSet = new Set(rolePerms);
    for (const o of overrides) {
      if (o.overrideType === "GRANT") effectiveSet.add(o.permissionCode);
      else if (o.overrideType === "REVOKE") effectiveSet.delete(o.permissionCode);
    }

    const allCodes = allPermissions.map((p) => p.code);
    const viewPrefixes = new Set<string>();
    for (const code of allCodes) {
      if (code.endsWith(":view")) {
        viewPrefixes.add(code.slice(0, -":view".length));
      }
    }

    const violations: string[] = [];
    for (const prefix of viewPrefixes) {
      const viewCode = `${prefix}:view`;
      if (effectiveSet.has(viewCode)) continue;
      const hasNonView = allCodes.some(
        (code) =>
          code.startsWith(`${prefix}:`) &&
          code !== viewCode &&
          effectiveSet.has(code)
      );
      if (hasNonView) {
        violations.push(prefix);
      }
    }

    if (violations.length > 0) {
      return {
        success: false,
        error: `View permission is required for: ${violations.join(", ")}`,
      };
    }

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
  const authResult = await checkAuth("permissions:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify target user belongs to this salon via UserSalon
    const membership = await prisma.userSalon.findUnique({
      where: { userId_salonId: { userId: targetUserId, salonId: authResult.salonId } },
      select: { roleDefinitionId: true, isActive: true },
    });

    if (!membership || !membership.isActive) {
      return { success: false, error: "User not found in this salon" };
    }

    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.roleId, membership.roleDefinitionId, authResult.isSuperAdmin, authResult.salonId))) {
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
