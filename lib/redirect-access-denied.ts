import "server-only";

import { redirect } from "next/navigation";

/**
 * Redirects to the access-denied page with optional missing permission codes.
 * Permission codes are base64url-encoded to keep URLs clean.
 *
 * Usage:
 *   redirectAccessDenied()                          // generic "no role" message
 *   redirectAccessDenied(["expenses:view"])         // specific missing permissions
 *   redirectAccessDenied(["expenses:view", "expenses:update"])
 *   redirectAccessDenied(undefined, "Custom reason") // contextual denial (e.g.
 *                                                    // hierarchy) — NOT a missing permission
 */
export function redirectAccessDenied(missingPermissions?: string[], reason?: string): never {
  const params = new URLSearchParams();
  if (missingPermissions && missingPermissions.length > 0) {
    params.set("r", Buffer.from(missingPermissions.join(",")).toString("base64url"));
  }
  if (reason) {
    params.set("m", Buffer.from(reason).toString("base64url"));
  }
  const qs = params.toString();
  redirect(qs ? `/dashboard/access-denied?${qs}` : "/dashboard/access-denied");
}
