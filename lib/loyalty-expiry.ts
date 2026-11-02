import "server-only";
import { LoyaltyTransactionType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateTier, DEFAULT_TIER_THRESHOLDS, type TierThresholds } from "@/lib/utils/loyalty";

export interface ExpiryResult {
  clientsAffected: number;
  totalPointsExpired: number;
}

/** Clients handled per transaction. Each batch is a handful of bulk queries plus one balance update
 *  per affected client, so it stays well inside the timeout even against a remote database. */
const CLIENTS_PER_BATCH = 100;
const BATCH_TIMEOUT_MS = 30_000;
const EXPIRING_TYPES = [LoyaltyTransactionType.EARNED, LoyaltyTransactionType.BONUS];

/**
 * Expire loyalty points past their expiry date. For each client with EARNED/BONUS transactions whose
 * expiresAt has passed: take those points off the balance, record an EXPIRED transaction, and null
 * out expiresAt on the processed records, stamping expiredAt so a later cancel or refund of the sale
 * doesn't take the same points off again. A sale's earned points already part-refunded only expire
 * for what is left.
 *
 * Covers one salon (`onlySalonId`, a manager's run) or every salon (the cron endpoint), each by its
 * own settings, a batch of clients per short transaction. One salon failing doesn't stop the others;
 * the run reports the failure once every salon has had its turn. Deliberately NOT a server action: it
 * has no sign-in check of its own, so it must only be called by the cron route (which checks its
 * secret) or by processExpiredPoints (which checks sign-in).
 */
export async function expirePoints(onlySalonId: string | null): Promise<ExpiryResult> {
  const now = new Date();
  // The salons with points expiry turned on, and each one's tier thresholds. Read directly (not
  // through getSettings, which needs a signed-in user the cron endpoint doesn't have).
  const salonSettings = await prisma.settings.findMany({
    where: { pointsExpiryEnabled: true, ...(onlySalonId !== null ? { salonId: onlySalonId } : {}) },
    select: { salonId: true, goldThreshold: true, platinumThreshold: true },
  });
  const thresholdsBySalon = new Map(
    salonSettings.map((s) => [s.salonId, { goldThreshold: s.goldThreshold, platinumThreshold: s.platinumThreshold }])
  );

  const total: ExpiryResult = { clientsAffected: 0, totalPointsExpired: 0 };
  const failed: unknown[] = [];
  for (const salonId of thresholdsBySalon.keys()) {
    try {
      await expireSalon(salonId, thresholdsBySalon, now, total);
    } catch (error) {
      console.error(`Expiring loyalty points failed for salon ${salonId}:`, error);
      failed.push(error);
    }
  }
  if (failed.length > 0) throw new AggregateError(failed, `Points expiry failed for ${failed.length} salon(s)`);
  return total;
}

/** Work through one salon's due clients, a batch per transaction, adding to `total`. */
async function expireSalon(
  salonId: string,
  thresholdsBySalon: Map<string, TierThresholds>,
  now: Date,
  total: ExpiryResult
): Promise<void> {
  // Every handled client's due rows are cleared, so each lookup moves on to the next clients.
  for (;;) {
    // groupBy (not findMany's distinct, which Prisma applies in memory) so only the ids are read.
    const due = await prisma.loyaltyTransaction.groupBy({
      by: ["clientId"],
      where: { salonId, expiresAt: { lt: now }, type: { in: EXPIRING_TYPES } },
      orderBy: { clientId: "asc" },
      take: CLIENTS_PER_BATCH,
    });
    if (due.length === 0) return;
    const batch = await prisma.$transaction(
      (tx) => expireClients(tx, { salonId, clientIds: due.map((d) => d.clientId), thresholdsBySalon, now }),
      { timeout: BATCH_TIMEOUT_MS }
    );
    total.clientsAffected += batch.clientsAffected;
    total.totalPointsExpired += batch.totalPointsExpired;
    if (due.length < CLIENTS_PER_BATCH) return;
  }
}

/** Expire one batch of a salon's clients, inside one transaction. */
async function expireClients(
  tx: Prisma.TransactionClient,
  { salonId, clientIds, thresholdsBySalon, now }: {
    salonId: string;
    clientIds: string[];
    thresholdsBySalon: Map<string, TierThresholds>;
    now: Date;
  }
): Promise<ExpiryResult> {
  // One expiry run per salon at a time (a second waits here, then finds these rows cleared). The
  // two-part key keeps this lock apart from any other lock keyed on a salon id.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"loyalty-expiry"}), hashtext(${salonId}))`;
  // Lock the clients' balances before reading anything, so a refund or cancel at the same moment
  // either finishes first (and is seen below) or waits and retries; neither change is lost.
  const balances = await tx.$queryRaw<Array<{ clientId: string; balance: number; salonId: string }>>`
    SELECT "clientId", balance, "salonId" FROM loyalty_points WHERE "clientId" = ANY(${clientIds}) FOR UPDATE`;
  const rows = await tx.loyaltyTransaction.findMany({
    where: { clientId: { in: clientIds }, salonId, expiresAt: { lt: now }, type: { in: EXPIRING_TYPES } },
    select: { id: true, clientId: true, points: true, type: true, saleId: true },
  });
  if (rows.length === 0) return { clientsAffected: 0, totalPointsExpired: 0 };

  // A part refund already took some of a sale's earned points off the balance: only the rest can
  // expire. (A full refund or a cancel takes them all and clears the expiry date.)
  const earnedSaleIds = rows.flatMap((r) => (r.type === LoyaltyTransactionType.EARNED && r.saleId ? [r.saleId] : []));
  const refunded = earnedSaleIds.length
    ? await tx.invoice.findMany({
        where: { salonId, saleId: { in: earnedSaleIds } },
        select: { saleId: true, refunds: { select: { pointsReversed: true } } },
      })
    : [];
  const reversedBySale = new Map(refunded.map((inv) => [inv.saleId, inv.refunds.reduce((s, r) => s + r.pointsReversed, 0)]));
  const dueByClient = new Map<string, number>();
  for (const r of rows) {
    const reversed = r.type === LoyaltyTransactionType.EARNED && r.saleId ? reversedBySale.get(r.saleId) ?? 0 : 0;
    dueByClient.set(r.clientId, (dueByClient.get(r.clientId) ?? 0) + Math.max(0, r.points - reversed));
  }

  const result: ExpiryResult = { clientsAffected: 0, totalPointsExpired: 0 };
  const expiredRows: Prisma.LoyaltyTransactionCreateManyInput[] = [];
  for (const points of balances) {
    const expired = Math.min(dueByClient.get(points.clientId) ?? 0, points.balance);
    if (expired <= 0) continue;
    const newBalance = points.balance - expired;
    const thresholds = thresholdsBySalon.get(points.salonId) ?? DEFAULT_TIER_THRESHOLDS;
    await tx.loyaltyPoints.update({
      where: { clientId: points.clientId },
      data: { balance: newBalance, tier: calculateTier(newBalance, thresholds) },
    });
    expiredRows.push({
      salonId: points.salonId,
      clientId: points.clientId,
      points: -expired,
      type: LoyaltyTransactionType.EXPIRED,
      description: `${expired} points expired`,
    });
    result.totalPointsExpired += expired;
    result.clientsAffected += 1;
  }
  if (expiredRows.length > 0) await tx.loyaltyTransaction.createMany({ data: expiredRows });

  // Always mark the rows handled (even when nothing was left to take, or the client has no points
  // record), so they aren't picked up again.
  await tx.loyaltyTransaction.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { expiresAt: null, expiredAt: now },
  });
  return result;
}
