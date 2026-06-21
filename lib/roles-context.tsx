"use client";

import { createContext, useContext } from "react";

export type RoleInfo = {
  id: string;          // RoleDefinition id (per-salon). For system-role fallbacks
                       // with no DB row, this falls back to the slug.
  name: string;        // Display name (e.g., "Owner")
  slug: string;        // Internal identifier (e.g., "owner")
  color: string;
  hierarchyLevel: number;
  isSystem: boolean;
};

const RolesContext = createContext<RoleInfo[]>([]);

export function RolesProvider({
  roles,
  children,
}: {
  roles: RoleInfo[];
  children: React.ReactNode;
}) {
  return (
    <RolesContext.Provider value={roles}>
      {children}
    </RolesContext.Provider>
  );
}

export function useRoles(): RoleInfo[] {
  return useContext(RolesContext);
}

/** Get display name for a role given its slug. */
export function useRoleLabel(roleSlug: string): string {
  const roles = useContext(RolesContext);
  const found = roles.find((r) => r.slug === roleSlug);
  return found?.name ?? roleSlug;
}

/** Get color for a role given its slug. */
export function useRoleColor(roleSlug: string): string {
  const roles = useContext(RolesContext);
  const found = roles.find((r) => r.slug === roleSlug);
  return found?.color ?? "#6B7280";
}
