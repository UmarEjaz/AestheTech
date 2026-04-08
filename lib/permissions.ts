import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet } from "@/lib/redis";
import { DEFAULT_PERMISSION_ROLES } from "./permissions-defaults";
import { SYSTEM_ROLE_HIERARCHY } from "./roles";

export type Permission = string;

const PERMISSION_CACHE_TTL = 300; // 5 minutes

// ============================================
// Role-level permission loading
// ============================================

/**
 * Request-level dedup to avoid multiple Redis/DB calls for the same salon+role
 * within a single server request.
 */
const requestCache = new Map<string, Promise<Set<string>>>();

async function loadPermissionsFromDB(salonId: string, role: string): Promise<Set<string>> {
  const cacheKey = `salon:${salonId}:perms:${role}`;

  // Check Redis first
  const cached = await cacheGet<string[]>(cacheKey);
  if (cached) return new Set(cached);

  // Query DB
  const rolePerms = await prisma.rolePermission.findMany({
    where: { salonId, role },
    include: { permission: { select: { code: true } } },
  });

  const permCodes = rolePerms.map((rp) => rp.permission.code);

  // If no DB records exist for this salon+role, fall back to hardcoded defaults
  // This handles salons that haven't been provisioned with permissions yet
  if (permCodes.length === 0) {
    const defaults = Object.entries(DEFAULT_PERMISSION_ROLES)
      .filter(([, roles]) => roles.includes(role))
      .map(([code]) => code);
    return new Set(defaults);
  }

  // Cache in Redis
  await cacheSet(cacheKey, permCodes, PERMISSION_CACHE_TTL);

  return new Set(permCodes);
}

/**
 * Dedup wrapper — ensures only one DB/Redis call per salon+role per request.
 */
function getPermissionSet(salonId: string, role: string): Promise<Set<string>> {
  const key = `${salonId}:${role}`;
  if (!requestCache.has(key)) {
    const promise = loadPermissionsFromDB(salonId, role);
    requestCache.set(key, promise);
    // Clean up after promise resolves to prevent memory leak across requests in dev
    promise.finally(() => {
      setTimeout(() => requestCache.delete(key), 100);
    });
  }
  return requestCache.get(key)!;
}

// ============================================
// User-level override loading
// ============================================

const userOverrideCache = new Map<string, Promise<Map<string, "GRANT" | "REVOKE">>>();

async function loadUserOverridesFromDB(
  salonId: string,
  userId: string
): Promise<Map<string, "GRANT" | "REVOKE">> {
  const cacheKey = `salon:${salonId}:userperms:${userId}`;

  // Check Redis first
  const cached = await cacheGet<Array<{ code: string; type: "GRANT" | "REVOKE" }>>(cacheKey);
  if (cached) return new Map(cached.map((c) => [c.code, c.type]));

  // Query DB
  const userPerms = await prisma.userPermission.findMany({
    where: { salonId, userId },
    include: { permission: { select: { code: true } } },
  });

  if (userPerms.length === 0) return new Map();

  const entries = userPerms.map((up) => ({
    code: up.permission.code,
    type: up.overrideType as "GRANT" | "REVOKE",
  }));

  // Cache in Redis
  await cacheSet(cacheKey, entries, PERMISSION_CACHE_TTL);

  return new Map(entries.map((e) => [e.code, e.type]));
}

/**
 * Dedup wrapper for user overrides.
 */
function getUserOverrides(salonId: string, userId: string): Promise<Map<string, "GRANT" | "REVOKE">> {
  const key = `${salonId}:user:${userId}`;
  if (!userOverrideCache.has(key)) {
    const promise = loadUserOverridesFromDB(salonId, userId);
    userOverrideCache.set(key, promise);
    promise.finally(() => {
      setTimeout(() => userOverrideCache.delete(key), 100);
    });
  }
  return userOverrideCache.get(key)!;
}

// ============================================
// Role hierarchy loading
// ============================================

const hierarchyCache = new Map<string, Promise<Record<string, number>>>();

/**
 * Load role hierarchy levels from DB, with fallback to system defaults.
 * Combines system role definitions + salon-specific custom roles.
 */
async function loadHierarchyLevels(salonId?: string | null): Promise<Record<string, number>> {
  const cacheKey = salonId ? `roles:hierarchy:${salonId}` : "roles:hierarchy:system";

  // Check Redis
  const cached = await cacheGet<Record<string, number>>(cacheKey);
  if (cached) return cached;

  try {
    // Query role definitions: system roles (salonId=null) + salon custom roles
    const where = salonId
      ? { OR: [{ salonId: null }, { salonId }], isActive: true }
      : { isSystem: true, isActive: true };

    const roleDefs = await prisma.roleDefinition.findMany({
      where,
      select: { name: true, hierarchyLevel: true },
    });

    if (roleDefs.length === 0) {
      // No role definitions in DB yet — use hardcoded defaults
      return { ...SYSTEM_ROLE_HIERARCHY };
    }

    const levels: Record<string, number> = {};
    for (const rd of roleDefs) {
      levels[rd.name] = rd.hierarchyLevel;
    }

    // Cache in Redis
    await cacheSet(cacheKey, levels, PERMISSION_CACHE_TTL);

    return levels;
  } catch {
    // Fallback to hardcoded system levels
    return { ...SYSTEM_ROLE_HIERARCHY };
  }
}

function getHierarchyLevels(salonId?: string | null): Promise<Record<string, number>> {
  const key = salonId || "system";
  if (!hierarchyCache.has(key)) {
    const promise = loadHierarchyLevels(salonId);
    hierarchyCache.set(key, promise);
    promise.finally(() => {
      setTimeout(() => hierarchyCache.delete(key), 100);
    });
  }
  return hierarchyCache.get(key)!;
}

// ============================================
// Public API
// ============================================

/**
 * Check if a role has a specific permission at a given salon.
 * Resolution order: SUPER_ADMIN bypass -> user overrides -> role permissions -> hardcoded defaults.
 */
export async function hasPermission(
  role: string | null,
  permission: Permission,
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!role) return false;

  // Check user-level overrides first (short-circuit layer)
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    const override = overrides.get(permission);
    if (override === "GRANT") return true;
    if (override === "REVOKE") return false;
    // No override — fall through to role permissions
  }

  // When no salonId, fall back to hardcoded defaults
  if (!salonId) {
    const defaults = DEFAULT_PERMISSION_ROLES[permission];
    return defaults ? defaults.includes(role) : false;
  }

  const permSet = await getPermissionSet(salonId, role);
  return permSet.has(permission);
}

/**
 * Check if a role has any of the specified permissions.
 */
export async function hasAnyPermission(
  role: string | null,
  perms: Permission[],
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!role) return false;

  // Check user overrides first
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    for (const p of perms) {
      const override = overrides.get(p);
      if (override === "GRANT") return true;
    }
    // If any were explicitly revoked, we need to check the rest against role perms
    // So we fall through to role-level check but skip revoked ones
    if (overrides.size > 0) {
      if (!salonId) {
        return perms.some((p) => {
          const ov = overrides.get(p);
          if (ov === "REVOKE") return false;
          const defaults = DEFAULT_PERMISSION_ROLES[p];
          return defaults ? defaults.includes(role) : false;
        });
      }
      const permSet = await getPermissionSet(salonId, role);
      return perms.some((p) => {
        const ov = overrides.get(p);
        if (ov === "GRANT") return true;
        if (ov === "REVOKE") return false;
        return permSet.has(p);
      });
    }
  }

  // Load once, check all
  if (!salonId) {
    return perms.some((p) => {
      const defaults = DEFAULT_PERMISSION_ROLES[p];
      return defaults ? defaults.includes(role) : false;
    });
  }

  const permSet = await getPermissionSet(salonId, role);
  return perms.some((p) => permSet.has(p));
}

/**
 * Check if a role has all of the specified permissions.
 */
export async function hasAllPermissions(
  role: string | null,
  perms: Permission[],
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!role) return false;

  // Check with user overrides
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    if (overrides.size > 0) {
      if (!salonId) {
        return perms.every((p) => {
          const ov = overrides.get(p);
          if (ov === "GRANT") return true;
          if (ov === "REVOKE") return false;
          const defaults = DEFAULT_PERMISSION_ROLES[p];
          return defaults ? defaults.includes(role) : false;
        });
      }
      const permSet = await getPermissionSet(salonId, role);
      return perms.every((p) => {
        const ov = overrides.get(p);
        if (ov === "GRANT") return true;
        if (ov === "REVOKE") return false;
        return permSet.has(p);
      });
    }
  }

  if (!salonId) {
    return perms.every((p) => {
      const defaults = DEFAULT_PERMISSION_ROLES[p];
      return defaults ? defaults.includes(role) : false;
    });
  }

  const permSet = await getPermissionSet(salonId, role);
  return perms.every((p) => permSet.has(p));
}

/**
 * Get all permissions for a role at a given salon, with user overrides merged.
 */
export async function getPermissionsForRole(
  role: string | null,
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<string[]> {
  if (isSuperAdmin) {
    return Object.keys(DEFAULT_PERMISSION_ROLES);
  }
  if (!role) return [];

  let permSet: Set<string>;
  if (!salonId) {
    permSet = new Set(
      Object.entries(DEFAULT_PERMISSION_ROLES)
        .filter(([, roles]) => roles.includes(role))
        .map(([code]) => code)
    );
  } else {
    permSet = new Set(await getPermissionSet(salonId, role));
  }

  // Apply user overrides
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    for (const [code, type] of overrides) {
      if (type === "GRANT") permSet.add(code);
      if (type === "REVOKE") permSet.delete(code);
    }
  }

  return Array.from(permSet);
}

/**
 * Check if a role can manage other roles (role hierarchy).
 * Now async — reads hierarchy levels from DB/cache.
 * SUPER_ADMIN can manage all roles.
 */
export async function canManageRole(
  managerRole: string | null,
  targetRole: string,
  isSuperAdmin = false,
  salonId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!managerRole) return false;

  const levels = await getHierarchyLevels(salonId);

  const managerLevel = levels[managerRole] ?? 0;
  const targetLevel = levels[targetRole] ?? 0;

  return managerLevel > targetLevel;
}
