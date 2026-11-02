"use server";

import { checkAuth } from "@/lib/auth-helpers";
import { expirePoints, type ExpiryResult } from "@/lib/loyalty-expiry";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

/**
 * Expire past-due loyalty points at the signed-in manager's own salon (see lib/loyalty-expiry.ts).
 * Always checks sign-in; the nightly job calls expirePoints directly from the cron route instead.
 */
export async function processExpiredPoints(): Promise<ActionResult<ExpiryResult>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) return { success: false, error: "Unauthorized" };

  try {
    const result = await expirePoints(authResult.salonId);
    if (result.totalPointsExpired > 0) {
      await logAudit({
        action: "POINTS_EXPIRED",
        entityType: "LoyaltyPoints",
        userId: authResult.userId,
        userRole: authResult.role,
        salonId: authResult.salonId,
        details: { ...result },
      });
    }
    return { success: true, data: result };
  } catch (error) {
    console.error("Error processing expired points:", error);
    return { success: false, error: "Failed to process expired points" };
  }
}
