"use client";

import { createContext, useContext } from "react";
import type { ModuleKey } from "@/lib/modules";

// The set of DISABLED module keys for the active salon (empty = all enabled).
const ModulesContext = createContext<ModuleKey[]>([]);

export function ModulesProvider({
  disabledModules,
  children,
}: {
  disabledModules: ModuleKey[];
  children: React.ReactNode;
}) {
  return (
    <ModulesContext.Provider value={disabledModules}>{children}</ModulesContext.Provider>
  );
}

/** List of disabled module keys for the active salon. */
export function useDisabledModules(): ModuleKey[] {
  return useContext(ModulesContext);
}

/** Whether a given module is enabled for the active salon. */
export function useIsModuleEnabled(moduleKey: ModuleKey): boolean {
  return !useContext(ModulesContext).includes(moduleKey);
}
