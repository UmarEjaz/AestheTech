/** System role identifiers (slugs) — these match RoleDefinition.slug for the built-in roles */
export const SYSTEM_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  STAFF: "staff",
  RECEPTIONIST: "receptionist",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Check if a slug identifies a system role */
export function isSystemRole(slug: string): slug is SystemRole {
  return Object.values(SYSTEM_ROLES).includes(slug as SystemRole);
}

/** Default system role definitions (for seeding) */
export const SYSTEM_ROLE_DEFINITIONS = [
  {
    name: "Owner",
    slug: "owner",
    description: "Full access to all features",
    color: "#9333EA",
    hierarchyLevel: 100,
    isSystem: true,
  },
  {
    name: "Admin",
    slug: "admin",
    description: "Manage staff, clients, and settings",
    color: "#3B82F6",
    hierarchyLevel: 75,
    isSystem: true,
  },
  {
    name: "Staff",
    slug: "staff",
    description: "Provide services and view schedules",
    color: "#22C55E",
    hierarchyLevel: 50,
    isSystem: true,
  },
  {
    name: "Receptionist",
    slug: "receptionist",
    description: "Handle appointments and check-ins",
    color: "#EAB308",
    hierarchyLevel: 25,
    isSystem: true,
  },
] as const;

/** Hardcoded system role hierarchy levels (fallback when DB is unavailable), keyed by slug */
export const SYSTEM_ROLE_HIERARCHY: Record<string, number> = {
  owner: 100,
  admin: 75,
  staff: 50,
  receptionist: 25,
};
