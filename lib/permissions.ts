import { Role } from "@prisma/client";

// Permission definitions — salon-level roles only (SUPER_ADMIN bypasses all checks)
export const permissions: Record<string, Role[]> = {
  // Client Management
  "clients:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "clients:create": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "clients:update": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "clients:delete": [Role.OWNER, Role.ADMIN],

  // Appointments
  "appointments:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "appointments:create": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "appointments:update": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "appointments:delete": [Role.OWNER, Role.ADMIN],

  // Sales
  "sales:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "sales:create": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "sales:update": [Role.OWNER, Role.ADMIN],
  "sales:delete": [Role.OWNER],

  // Invoices
  "invoices:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "invoices:create": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "invoices:update": [Role.OWNER, Role.ADMIN],
  "invoices:delete": [Role.OWNER],
  "invoices:refund": [Role.OWNER, Role.ADMIN],

  // Staff Management
  "staff:view": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "staff:create": [Role.OWNER, Role.ADMIN],
  "staff:update": [Role.OWNER, Role.ADMIN],
  "staff:delete": [Role.OWNER],

  // Schedules
  "schedules:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "schedules:manage": [Role.OWNER, Role.ADMIN],

  // Reports
  "reports:view": [Role.OWNER, Role.ADMIN],
  "reports:financial": [Role.OWNER],

  // Settings
  "settings:view": [Role.OWNER, Role.ADMIN],
  "settings:manage": [Role.OWNER],

  // Services
  "services:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "services:manage": [Role.OWNER, Role.ADMIN],

  // Products
  "products:view": [Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "products:manage": [Role.OWNER, Role.ADMIN],

  // Loyalty
  "loyalty:view": [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "loyalty:manage": [Role.OWNER, Role.ADMIN],

  // Branches
  "branches:view": [Role.OWNER],
  "branches:manage": [Role.OWNER],

  // Audit
  "audit:view": [Role.OWNER],
};

export type Permission = keyof typeof permissions;

/**
 * Check if a role has a specific permission.
 * SUPER_ADMIN (isSuperAdmin) bypasses all permission checks.
 */
export function hasPermission(role: Role, permission: Permission, isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;
  const allowedRoles = permissions[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, perms: Permission[], isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;
  return perms.some((permission) => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: Role, perms: Permission[], isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;
  return perms.every((permission) => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role, isSuperAdmin = false): Permission[] {
  if (isSuperAdmin) {
    return Object.keys(permissions) as Permission[];
  }
  return (Object.keys(permissions) as Permission[]).filter((permission) =>
    permissions[permission]?.includes(role)
  );
}

/**
 * Check if a role can manage other roles (for user management within a salon).
 * SUPER_ADMIN can manage all roles.
 */
export function canManageRole(managerRole: Role, targetRole: Role, isSuperAdmin = false): boolean {
  if (isSuperAdmin) return true;

  const roleHierarchy: Record<Role, number> = {
    [Role.OWNER]: 4,
    [Role.ADMIN]: 3,
    [Role.STAFF]: 2,
    [Role.RECEPTIONIST]: 1,
  };

  return roleHierarchy[managerRole] > roleHierarchy[targetRole];
}
