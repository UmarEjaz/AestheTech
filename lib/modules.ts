/**
 * Per-salon module toggles — canonical registry.
 *
 * A "module" is a top-level dashboard area a Super Admin can turn ON or OFF for a
 * specific salon (from /admin). This is a separate layer from permissions:
 *   - permissions answer "can THIS USER do X?"
 *   - module toggles answer "is X available in THIS SALON at all?"
 * A feature is shown/accessible only when BOTH pass.
 *
 * Storage: `Settings.disabledModules` holds the list of DISABLED module keys for a
 * salon (empty = all enabled). Storing the disabled set keeps "all modules ON by
 * default" trivial (empty list) and future-proof (a newly added module is enabled
 * everywhere automatically, since it's in no salon's disabled list).
 */

export type ModuleKey =
  | "appointments"
  | "clients"
  | "services"
  | "products"
  | "sales"
  | "invoices"
  | "schedules"
  | "staff"
  | "reports"
  | "loyalty"
  | "expenses"
  | "payroll"
  | "branches"
  | "audit"
  | "roles";

export interface ModuleDef {
  /** Stable key stored in Settings.disabledModules and matched from routes/permissions. */
  key: ModuleKey;
  /** Human label for the toggle UI. */
  label: string;
  /** Dashboard route root for this module (used for route → module matching). */
  href: string;
  /** Additional route roots that belong to this module (e.g. a second page). */
  extraHrefs?: string[];
  /**
   * Permission-code prefixes that belong to this module. Used to fold the module
   * check into checkAuth: a permission like "products:create" → module "products".
   * Sub-modules (e.g. product categories) are listed here so they follow the parent.
   */
  permissionPrefixes: string[];
}

/**
 * Toggleable modules (mirror the sidebar order). Dashboard and Settings are
 * intentionally NOT here — they are always-on (a salon must always be usable).
 */
export const TOGGLEABLE_MODULES: ModuleDef[] = [
  { key: "appointments", label: "Appointments", href: "/dashboard/appointments", permissionPrefixes: ["appointments"] },
  { key: "clients", label: "Clients", href: "/dashboard/clients", permissionPrefixes: ["clients"] },
  { key: "services", label: "Services", href: "/dashboard/services", permissionPrefixes: ["services", "service-categories"] },
  { key: "products", label: "Products", href: "/dashboard/products", permissionPrefixes: ["products", "product-categories"] },
  { key: "sales", label: "Sales", href: "/dashboard/sales", permissionPrefixes: ["sales"] },
  { key: "invoices", label: "Invoices", href: "/dashboard/invoices", permissionPrefixes: ["invoices"] },
  { key: "schedules", label: "Schedules", href: "/dashboard/schedules", permissionPrefixes: ["schedules"] },
  { key: "staff", label: "Staff", href: "/dashboard/staff", permissionPrefixes: ["staff"] },
  { key: "reports", label: "Reports", href: "/dashboard/reports", permissionPrefixes: ["reports", "profit"] },
  { key: "loyalty", label: "Loyalty", href: "/dashboard/loyalty", permissionPrefixes: ["loyalty"] },
  { key: "expenses", label: "Expenses", href: "/dashboard/expenses", permissionPrefixes: ["expenses", "expense-categories"] },
  { key: "payroll", label: "Payroll", href: "/dashboard/payroll", permissionPrefixes: ["payroll"] },
  { key: "branches", label: "Branches", href: "/dashboard/branches", permissionPrefixes: ["branches"] },
  { key: "audit", label: "Audit Log", href: "/dashboard/audit-log", permissionPrefixes: ["audit"] },
  // Lives under always-on Settings, but independently toggleable. Two routes,
  // so href is the primary; extraHrefs covers the second.
  { key: "roles", label: "Roles & Permissions", href: "/dashboard/settings/roles", permissionPrefixes: ["roles", "permissions"], extraHrefs: ["/dashboard/settings/permissions"] },
];

export const TOGGLEABLE_MODULE_KEYS: ModuleKey[] = TOGGLEABLE_MODULES.map((m) => m.key);

/** Per-salon module on/off state, for the Super Admin toggle UI. */
export interface SalonModuleState {
  key: ModuleKey;
  label: string;
  enabled: boolean;
}

const TOGGLEABLE_KEY_SET = new Set<string>(TOGGLEABLE_MODULE_KEYS);

/** Whether a key is a real, toggleable module (used to validate writes). */
export function isToggleableModuleKey(key: string): key is ModuleKey {
  return TOGGLEABLE_KEY_SET.has(key);
}

// Permission-prefix → module key, for folding module checks into permission checks.
const PREFIX_TO_MODULE = new Map<string, ModuleKey>();
for (const m of TOGGLEABLE_MODULES) {
  for (const prefix of m.permissionPrefixes) PREFIX_TO_MODULE.set(prefix, m.key);
}

/**
 * Map a permission code (e.g. "products:create") to its toggleable module key, or
 * null if the permission doesn't belong to a toggleable module (e.g. "settings:view",
 * "data:all-branches" — always-on / cross-cutting, never gated by module toggles).
 */
export function moduleKeyForPermission(permission: string): ModuleKey | null {
  const prefix = permission.split(":")[0];
  return PREFIX_TO_MODULE.get(prefix) ?? null;
}

/**
 * Map a dashboard pathname (e.g. "/dashboard/products/categories") to its module key,
 * or null if it isn't under a toggleable module (e.g. "/dashboard" or "/dashboard/settings").
 *
 * Matches the MOST SPECIFIC (longest) route root, so a nested module like
 * "/dashboard/settings/roles" resolves to `roles` even though it sits under Settings.
 */
export function moduleKeyForPath(pathname: string): ModuleKey | null {
  let best: { key: ModuleKey; len: number } | null = null;
  for (const m of TOGGLEABLE_MODULES) {
    for (const root of [m.href, ...(m.extraHrefs ?? [])]) {
      if (pathname === root || pathname.startsWith(root + "/")) {
        if (!best || root.length > best.len) best = { key: m.key, len: root.length };
      }
    }
  }
  return best?.key ?? null;
}
