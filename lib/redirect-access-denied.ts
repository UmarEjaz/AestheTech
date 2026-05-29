import "server-only";

import { redirect } from "next/navigation";

/**
 * Redirects to the access-denied page with optional missing permission codes.
 * Permission codes are base64url-encoded to keep URLs clean.
 *
 * Usage:
 *   redirectAccessDenied()                         // generic "no role" message
 *   redirectAccessDenied(["expenses:view"])         // specific missing permissions
 *   redirectAccessDenied(["expenses:view", "expenses:update"])
 */
export function redirectAccessDenied(missingPermissions?: string[]): never {
  if (missingPermissions && missingPermissions.length > 0) {
    const encoded = Buffer.from(missingPermissions.join(",")).toString("base64url");
    redirect(`/dashboard/access-denied?r=${encoded}`);
  }
  redirect("/dashboard/access-denied");
}
