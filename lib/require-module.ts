import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/actions/modules";
import { ModuleKey } from "@/lib/modules";

/**
 * Page guard for per-salon module toggles. Call near the top of a toggleable
 * module's page (after the normal permission check). If the module is disabled
 * for the active salon, redirect to the "module unavailable" page.
 *
 * Mirrors the impersonation rule used in checkAuth:
 *  - A real super admin in "Enter salon" (PLATFORM) mode bypasses the gate and
 *    can view disabled modules for support.
 *  - "Login as Owner" (AS_USER) and ordinary tenant users respect the toggle.
 */
export async function requireModule(moduleKey: ModuleKey): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user?.salonId) return; // no active salon → other guards handle it

  // Effective super admin (PLATFORM "Enter salon") sees everything.
  if (user.isSuperAdmin === true) return;

  if (!(await isModuleEnabled(user.salonId, moduleKey))) {
    redirect(`/dashboard/module-unavailable?m=${encodeURIComponent(moduleKey)}`);
  }
}
