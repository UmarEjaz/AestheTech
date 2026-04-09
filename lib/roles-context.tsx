"use client";

import { createContext, useContext } from "react";

export type RoleInfo = {
  name: string;
  label: string;
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

export function useRoleLabel(roleName: string): string {
  const roles = useContext(RolesContext);
  const found = roles.find((r) => r.name === roleName);
  return found?.label ?? roleName;
}

export function useRoleColor(roleName: string): string {
  const roles = useContext(RolesContext);
  const found = roles.find((r) => r.name === roleName);
  return found?.color ?? "#6B7280";
}
