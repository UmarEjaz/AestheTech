import { Role } from "@prisma/client";

// Permission definitions
export const permissions: Record<string, Role[]> = {
  // Client Management
  "clients:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "clients:create": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "clients:update": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "clients:delete": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],

  // Appointments
  "appointments:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "appointments:create": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "appointments:update": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "appointments:delete": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],

  // Sales
  "sales:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "sales:create": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "sales:update": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "sales:delete": [Role.SUPER_ADMIN, Role.OWNER],

  // Invoices
  "invoices:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "invoices:create": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "invoices:update": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "invoices:delete": [Role.SUPER_ADMIN, Role.OWNER],
  "invoices:refund": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],

  // Staff Management
  "staff:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "staff:create": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "staff:update": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "staff:delete": [Role.SUPER_ADMIN, Role.OWNER],

  // Schedules
  "schedules:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "schedules:manage": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],

  // Reports
  "reports:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "reports:financial": [Role.SUPER_ADMIN, Role.OWNER],

  // Settings
  "settings:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  "settings:manage": [Role.SUPER_ADMIN, Role.OWNER],

  // Services
  "services:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  "services:manage": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],

  // Loyalty
  "loyalty:view": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  "loyalty:manage": [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
};

export type Permission = keyof typeof permissions;

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const allowedRoles = permissions[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, perms: Permission[]): boolean {
  return perms.some((permission) => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: Role, perms: Permission[]): boolean {
  return perms.every((permission) => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return (Object.keys(permissions) as Permission[]).filter((permission) =>
    permissions[permission]?.includes(role)
  );
}

/**
 * Check if a role can manage other roles (for user management)
 */
export function canManageRole(managerRole: Role, targetRole: Role): boolean {
  const roleHierarchy: Record<Role, number> = {
    [Role.SUPER_ADMIN]: 5,
    [Role.OWNER]: 4,
    [Role.ADMIN]: 3,
    [Role.STAFF]: 2,
    [Role.RECEPTIONIST]: 1,
  };

  return roleHierarchy[managerRole] > roleHierarchy[targetRole];
}
