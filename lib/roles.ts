/** System role names — replaces the Prisma Role enum */
export const SYSTEM_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  RECEPTIONIST: "RECEPTIONIST",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Check if a role name is a system role */
export function isSystemRole(role: string): role is SystemRole {
  return Object.values(SYSTEM_ROLES).includes(role as SystemRole);
}

/** Default system role definitions (for seeding) */
export const SYSTEM_ROLE_DEFINITIONS = [
  {
    name: "OWNER",
    slug: "owner",
    label: "Owner",
    description: "Full access to all features",
    color: "#9333EA",
    hierarchyLevel: 100,
    isSystem: true,
  },
  {
    name: "ADMIN",
    slug: "admin",
    label: "Admin",
    description: "Manage staff, clients, and settings",
    color: "#3B82F6",
    hierarchyLevel: 75,
    isSystem: true,
  },
  {
    name: "STAFF",
    slug: "staff",
    label: "Staff",
    description: "Provide services and view schedules",
    color: "#22C55E",
    hierarchyLevel: 50,
    isSystem: true,
  },
  {
    name: "RECEPTIONIST",
    slug: "receptionist",
    label: "Receptionist",
    description: "Handle appointments and check-ins",
    color: "#EAB308",
    hierarchyLevel: 25,
    isSystem: true,
  },
] as const;

/** Hardcoded system role hierarchy levels (fallback when DB is unavailable) */
export const SYSTEM_ROLE_HIERARCHY: Record<string, number> = {
  OWNER: 100,
  ADMIN: 75,
  STAFF: 50,
  RECEPTIONIST: 25,
};
