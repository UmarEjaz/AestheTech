import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet } from "@/lib/redis";
import { DEFAULT_PERMISSION_ROLES } from "./permissions-defaults";

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

async function loadPermissionsFromDB(salonId: string, roleDefinitionId: string): Promise<Set<string>> {
  const cacheKey = `salon:${salonId}:perms:${roleDefinitionId}`;

  // Check Redis first
  const cached = await cacheGet<string[]>(cacheKey);
  if (cached) return new Set(cached);

  // Query DB using roleDefinitionId FK
  const rolePerms = await prisma.rolePermission.findMany({
    where: { salonId, roleDefinitionId },
    include: { permission: { select: { code: true } } },
  });

  const permCodes = rolePerms.map((rp) => rp.permission.code);

  // If this role has no permissions, check if the salon has been provisioned at all
  if (permCodes.length === 0) {
    // Check if ANY role has permissions for this salon
    const salonHasAnyPerms = await prisma.rolePermission.count({
      where: { salonId },
    });

    if (salonHasAnyPerms === 0) {
      // Salon hasn't been provisioned yet — use hardcoded defaults
      // Resolve roleDefinitionId → role name for fallback lookup
      const roleDef = await prisma.roleDefinition.findUnique({
        where: { id: roleDefinitionId },
        select: { name: true },
      });
      if (!roleDef) return new Set();

      const defaults = Object.entries(DEFAULT_PERMISSION_ROLES)
        .filter(([, roles]) => roles.includes(roleDef.name))
        .map(([code]) => code);
      return new Set(defaults);
    }

    // Salon IS provisioned but this role has zero permissions — intentional, keep empty
    return new Set();
  }

  // Cache in Redis
  await cacheSet(cacheKey, permCodes, PERMISSION_CACHE_TTL);

  return new Set(permCodes);
}

/**
 * Dedup wrapper — ensures only one DB/Redis call per salon+role per request.
 */
function getPermissionSet(salonId: string, roleDefinitionId: string): Promise<Set<string>> {
  const key = `${salonId}:${roleDefinitionId}`;
  if (!requestCache.has(key)) {
    const promise = loadPermissionsFromDB(salonId, roleDefinitionId);
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
 * Returns a map of roleDefinitionId → hierarchyLevel.
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
      select: { id: true, hierarchyLevel: true },
    });

    if (roleDefs.length === 0) {
      return {};
    }

    const levels: Record<string, number> = {};
    for (const rd of roleDefs) {
      levels[rd.id] = rd.hierarchyLevel;
    }

    // Cache in Redis
    await cacheSet(cacheKey, levels, PERMISSION_CACHE_TTL);

    return levels;
  } catch {
    return {};
  }
}

export function getHierarchyLevels(salonId?: string | null): Promise<Record<string, number>> {
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
 *
 * @param roleId - The roleDefinitionId (not the role name)
 */
export async function hasPermission(
  roleId: string | null,
  permission: Permission,
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!roleId) return false;

  // Check user-level overrides first (short-circuit layer)
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    const override = overrides.get(permission);
    if (override === "GRANT") return true;
    if (override === "REVOKE") return false;
    // No override — fall through to role permissions
  }

  // When no salonId, fall back to hardcoded defaults by resolving ID → name
  if (!salonId) {
    try {
      const roleDef = await prisma.roleDefinition.findUnique({
        where: { id: roleId },
        select: { name: true },
      });
      if (!roleDef) return false;
      const defaults = DEFAULT_PERMISSION_ROLES[permission];
      return defaults ? defaults.includes(roleDef.name) : false;
    } catch {
      return false;
    }
  }

  const permSet = await getPermissionSet(salonId, roleId);
  return permSet.has(permission);
}

/**
 * Check if a role has any of the specified permissions.
 */
export async function hasAnyPermission(
  roleId: string | null,
  perms: Permission[],
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!roleId) return false;

  // Check user overrides first
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    for (const p of perms) {
      const override = overrides.get(p);
      if (override === "GRANT") return true;
    }
    // If any were explicitly revoked, we need to check the rest against role perms
    if (overrides.size > 0) {
      const permSet = await getPermissionSet(salonId, roleId);
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
    try {
      const roleDef = await prisma.roleDefinition.findUnique({
        where: { id: roleId },
        select: { name: true },
      });
      if (!roleDef) return false;
      return perms.some((p) => {
        const defaults = DEFAULT_PERMISSION_ROLES[p];
        return defaults ? defaults.includes(roleDef.name) : false;
      });
    } catch {
      return false;
    }
  }

  const permSet = await getPermissionSet(salonId, roleId);
  return perms.some((p) => permSet.has(p));
}

/**
 * Check if a role has all of the specified permissions.
 */
export async function hasAllPermissions(
  roleId: string | null,
  perms: Permission[],
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!roleId) return false;

  // Check with user overrides
  if (salonId && userId) {
    const overrides = await getUserOverrides(salonId, userId);
    if (overrides.size > 0) {
      const permSet = await getPermissionSet(salonId, roleId);
      return perms.every((p) => {
        const ov = overrides.get(p);
        if (ov === "GRANT") return true;
        if (ov === "REVOKE") return false;
        return permSet.has(p);
      });
    }
  }

  if (!salonId) {
    try {
      const roleDef = await prisma.roleDefinition.findUnique({
        where: { id: roleId },
        select: { name: true },
      });
      if (!roleDef) return false;
      return perms.every((p) => {
        const defaults = DEFAULT_PERMISSION_ROLES[p];
        return defaults ? defaults.includes(roleDef.name) : false;
      });
    } catch {
      return false;
    }
  }

  const permSet = await getPermissionSet(salonId, roleId);
  return perms.every((p) => permSet.has(p));
}

/**
 * Get all permissions for a role at a given salon, with user overrides merged.
 */
export async function getPermissionsForRole(
  roleId: string | null,
  isSuperAdmin = false,
  salonId?: string | null,
  userId?: string | null
): Promise<string[]> {
  if (isSuperAdmin) {
    return Object.keys(DEFAULT_PERMISSION_ROLES);
  }
  if (!roleId) return [];

  let permSet: Set<string>;
  if (!salonId) {
    try {
      const roleDef = await prisma.roleDefinition.findUnique({
        where: { id: roleId },
        select: { name: true },
      });
      if (!roleDef) return [];
      permSet = new Set(
        Object.entries(DEFAULT_PERMISSION_ROLES)
          .filter(([, roles]) => roles.includes(roleDef.name))
          .map(([code]) => code)
      );
    } catch {
      return [];
    }
  } else {
    permSet = new Set(await getPermissionSet(salonId, roleId));
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
 * Now uses roleDefinitionIds instead of role names.
 * SUPER_ADMIN can manage all roles.
 */
export async function canManageRole(
  managerRoleId: string | null,
  targetRoleId: string,
  isSuperAdmin = false,
  salonId?: string | null
): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (!managerRoleId) return false;

  const levels = await getHierarchyLevels(salonId);

  const managerLevel = levels[managerRoleId];
  const targetLevel = levels[targetRoleId];
  if (managerLevel === undefined || targetLevel === undefined) {
    return false;
  }

  return managerLevel > targetLevel;
}
