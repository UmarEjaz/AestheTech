"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { Role } from "@prisma/client";
import { calculateTier } from "@/lib/utils/loyalty";
import { getSettings } from "./settings";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Process expired loyalty points.
 * Finds EARNED/BONUS transactions with expiresAt < now,
 * deducts from client balances, creates EXPIRED transactions,
 * and nulls out expiresAt on processed records.
 */
export async function processExpiredPoints(options?: { skipAuth?: boolean }): Promise<ActionResult<{
  clientsAffected: number;
  totalPointsExpired: number;
}>> {
  // Auth check unless called from cron
  if (!options?.skipAuth) {
    const session = await auth();
    if (!session?.user) return { success: false, error: "Unauthorized" };
    const role = session.user.role as Role;
    if (!hasPermission(role, "settings:manage")) {
      return { success: false, error: "Unauthorized" };
    }
  }

  try {
    const settingsResult = await getSettings();
    if (!settingsResult.success) {
      return { success: false, error: "Failed to fetch settings" };
    }
    const settings = settingsResult.data;
    if (!settings.pointsExpiryEnabled) {
      return { success: true, data: { clientsAffected: 0, totalPointsExpired: 0 } };
    }

    const thresholds = {
      goldThreshold: settings.goldThreshold,
      platinumThreshold: settings.platinumThreshold,
    };

    let totalPointsExpired = 0;
    let clientsAffected = 0;

    // Process inside a transaction with advisory lock to prevent concurrent runs
    await prisma.$transaction(async (tx) => {
      // Acquire advisory lock — blocks concurrent cron runs until this transaction commits
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(8675309)`;

      // Find all transactions that have expired
      const expiredTransactions = await tx.loyaltyTransaction.findMany({
        where: {
          expiresAt: { lt: new Date() },
          type: { in: ["EARNED", "BONUS"] },
        },
        select: {
          id: true,
          clientId: true,
          points: true,
        },
      });

      if (expiredTransactions.length === 0) return;

      // Group by client
      const clientExpiry = new Map<string, { transactionIds: string[]; totalPoints: number }>();
      for (const txn of expiredTransactions) {
        const existing = clientExpiry.get(txn.clientId);
        if (existing) {
          existing.transactionIds.push(txn.id);
          existing.totalPoints += txn.points;
        } else {
          clientExpiry.set(txn.clientId, {
            transactionIds: [txn.id],
            totalPoints: txn.points,
          });
        }
      }

      for (const [clientId, data] of clientExpiry) {
        const loyaltyPoints = await tx.loyaltyPoints.findUnique({
          where: { clientId },
        });

        if (!loyaltyPoints) continue;

        const pointsToExpire = Math.min(data.totalPoints, loyaltyPoints.balance);
        if (pointsToExpire <= 0) {
          // Still null out expiresAt to prevent re-processing
          await tx.loyaltyTransaction.updateMany({
            where: { id: { in: data.transactionIds } },
            data: { expiresAt: null },
          });
          continue;
        }

        const newBalance = loyaltyPoints.balance - pointsToExpire;
        const newTier = calculateTier(newBalance, thresholds);

        await tx.loyaltyPoints.update({
          where: { clientId },
          data: { balance: newBalance, tier: newTier },
        });

        await tx.loyaltyTransaction.create({
          data: {
            clientId,
            points: -pointsToExpire,
            type: "EXPIRED",
            description: `${pointsToExpire} points expired`,
          },
        });

        // Null out expiresAt on processed records (preserves history)
        await tx.loyaltyTransaction.updateMany({
          where: { id: { in: data.transactionIds } },
          data: { expiresAt: null },
        });

        totalPointsExpired += pointsToExpire;
        clientsAffected++;
      }
    });

    return {
      success: true,
      data: {
        clientsAffected,
        totalPointsExpired,
      },
    };
  } catch (error) {
    console.error("Error processing expired points:", error);
    return { success: false, error: "Failed to process expired points" };
  }
}
