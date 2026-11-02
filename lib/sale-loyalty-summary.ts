import "server-only";
import { prisma } from "@/lib/prisma";

export interface SaleLoyaltySummary {
  pointsEarned: number; // points this sale earned (EARNED + BONUS transactions)
  pointsBalance: number | null; // the client's current balance; null when the client has no loyalty record
}

/**
 * Loyalty figures printed on a sale's receipt (informational only — not part of the money totals).
 * Queried on demand by the sale detail page rather than through the sale list include, so list and
 * table queries stay lean. Callers check the salon's loyalty setting and skip walk-ins themselves.
 *
 * Deliberately NOT a server action: it has no auth check of its own and must only be called from
 * server code that has already authorised the caller for this sale.
 */
export async function getSaleLoyaltySummary(saleId: string, clientId: string): Promise<SaleLoyaltySummary> {
  const [earnedAgg, loyalty] = await Promise.all([
    prisma.loyaltyTransaction.aggregate({
      where: { saleId, type: { in: ["EARNED", "BONUS"] } },
      _sum: { points: true },
    }),
    prisma.loyaltyPoints.findUnique({
      where: { clientId },
      select: { balance: true },
    }),
  ]);
  return {
    pointsEarned: earnedAgg._sum.points ?? 0,
    pointsBalance: loyalty ? loyalty.balance : null,
  };
}
