import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/actions/modules";
import { getEffectiveActor } from "@/lib/effective-actor";
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
  if (!session?.user) return;

  // Resolve identity through the shared effective-actor source of truth, so this
  // guard agrees with pages and server actions: in "Login as Owner" (AS_USER)
  // isSuperAdmin is false → toggles are enforced; only PLATFORM ("Enter salon")
  // bypasses for support.
  const actor = getEffectiveActor(session.user);
  if (!actor.salonId) return; // no active salon → other guards handle it
  if (actor.isSuperAdmin) return; // effective super admin (PLATFORM) sees everything

  if (!(await isModuleEnabled(actor.salonId, moduleKey))) {
    redirect(`/dashboard/module-unavailable?m=${encodeURIComponent(moduleKey)}`);
  }
}
