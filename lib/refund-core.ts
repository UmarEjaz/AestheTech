import "server-only";
import { LoyaltyTransactionType, type Prisma } from "@prisma/client";
import { calculateTier, DEFAULT_TIER_THRESHOLDS, type TierThresholds } from "@/lib/utils/loyalty";
import { formatCurrency } from "@/lib/utils/currency";
import { refundableLeft, refundedOffBill } from "@/lib/utils/invoice-status";
import { getSettings } from "@/lib/actions/settings";

/** A refusal the person can act on (its message is safe to show); anything else stays a generic error. */
export class RefundRefusal extends Error {}

/** Shown when a refund or cancel lost a race with another change to the same bill (Postgres P2034). */
export const INVOICE_CHANGED = "This invoice just changed. Please reload and try again.";

/** What a refund needs from the salon's settings: the loyalty tiers (to re-tier a client whose points
 *  it takes back) and the currency (for its messages). Defaults when the settings can't be read. */
export async function refundSettings(): Promise<{ thresholds: TierThresholds; currencyCode: string }> {
  const settingsResult = await getSettings();
  if (!settingsResult.success) return { thresholds: DEFAULT_TIER_THRESHOLDS, currencyCode: "USD" };
  const { goldThreshold, platinumThreshold, currencyCode } = settingsResult.data;
  return { thresholds: { goldThreshold, platinumThreshold }, currencyCode };
}

/** What a refund needs loaded with the invoice (inside the caller's transaction). */
export const refundInvoiceInclude = {
  sale: {
    include: {
      items: {
        where: { productId: { not: null } },
        select: { productId: true, quantity: true },
      },
      // What the sale did to the client's points: earned, birthday bonus, and points spent on it.
      loyaltyTransactions: {
        where: {
          type: { in: [LoyaltyTransactionType.EARNED, LoyaltyTransactionType.BONUS, LoyaltyTransactionType.REDEEMED] },
        },
        select: { id: true, type: true, points: true, description: true, expiredAt: true },
      },
    },
  },
  payments: { select: { amount: true } },
  refunds: true,
} satisfies Prisma.InvoiceInclude;

export type RefundableInvoice = Prisma.InvoiceGetPayload<{ include: typeof refundInvoiceInclude }>;

/** The sale's points of one kind, as a positive number (spent points are stored negative). Points the
 *  expiry job already took off the balance are left out, so they are never taken off twice. */
function salePoints(invoice: RefundableInvoice, type: LoyaltyTransactionType): number {
  const sum = invoice.sale.loyaltyTransactions
    .filter((t) => t.type === type && !t.expiredAt)
    .reduce((s, t) => s + t.points, 0);
  return Math.abs(sum);
}

export interface RecordRefundInput {
  invoice: RefundableInvoice;
  amount: number;
  reason?: string | null;
  userId: string;
  salonId: string;
  thresholds: TierThresholds;
  currencyCode: string;
}

export interface RecordedRefund {
  refundId: string;
  pointsReversed: number; // the refund's share of the points (what later refunds count as already reversed)
  pointsTaken: number; // what actually came off the client's balance (less if they had already spent some)
  pointsReturned: number; // on a full refund, the points the client had spent on the bill, given back
  /** The refunds now cover the whole invoice total (stock has been restored). */
  isFullRefund: boolean;
}

/**
 * Record a refund inside the caller's transaction: the Refund row, the loyalty points it takes back
 * (proportional to the amount; all remaining points on a full refund, so rounding never strands any)
 * and, on a full refund, the product stock. Shared by the Refund button (createRefund) and by
 * cancelling a part-paid bill with "Refund" chosen, so both follow the same money rules. The caller
 * checks the invoice's status and sets it afterwards.
 */
export async function recordRefund(
  tx: Prisma.TransactionClient,
  { invoice, amount, reason, userId, salonId, thresholds, currencyCode }: RecordRefundInput
): Promise<RecordedRefund> {
  // What can still be refunded (inside the transaction for atomicity). Change handed back at checkout
  // on an overpaid deposit doesn't count against it: that money was never part of the bill.
  const total = Number(invoice.total);
  const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalRefunded = invoice.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const remainingRefundable = refundableLeft(total, paid, totalRefunded);

  if (amount > remainingRefundable + 0.01) {
    throw new RefundRefusal(`Refund amount exceeds the ${formatCurrency(remainingRefundable, currencyCode)} that can still be refunded`);
  }

  // Check if this will be a full refund (nothing left to refund)
  const isFullRefund = refundedOffBill(total, paid, totalRefunded + amount) >= total - 0.01;

  // Calculate points to reverse (proportional to refund amount)
  const totalPointsEarned = salePoints(invoice, LoyaltyTransactionType.EARNED);
  const pointsAlreadyReversed = invoice.refunds.reduce((sum, r) => sum + r.pointsReversed, 0);

  // If full refund, reverse all remaining points to avoid rounding loss
  // Otherwise use proportional calculation
  const pointsToReverse = isFullRefund
    ? Math.max(0, totalPointsEarned - pointsAlreadyReversed) // 0 once the earned points have expired
    : Math.floor(totalPointsEarned * (amount / total));

  const refund = await tx.refund.create({
    data: { salonId, invoiceId: invoice.id, amount, reason, refundedById: userId, pointsReversed: pointsToReverse },
  });

  // A full refund undoes the whole sale, as a cancel does: every remaining earned point and any
  // birthday bonus come back off, points spent on the bill go back to the client, and the products
  // go back into stock.
  if (isFullRefund) {
    const undone = await undoSale(tx, {
      invoice,
      pointsAlreadyReversed,
      returnSpentPoints: true,
      why: "refunded",
      salonId,
      thresholds,
    });
    return { refundId: refund.id, pointsReversed: pointsToReverse, ...undone, isFullRefund };
  }

  const pointsTaken = await takeBackPoints(tx, {
    invoice,
    points: pointsToReverse,
    salonId,
    thresholds,
    description: `Points reversed due to refund on invoice ${invoice.invoiceNumber}`,
  });
  return { refundId: refund.id, pointsReversed: pointsToReverse, pointsTaken, pointsReturned: 0, isFullRefund };
}

/** Take `points` off the client's balance (never below zero), re-tier them, and record why. Returns the
 *  points actually taken: fewer when the balance was lower, none when the client has no points record. */
async function takeBackPoints(
  tx: Prisma.TransactionClient,
  { invoice, points, salonId, thresholds, description }: {
    invoice: RefundableInvoice;
    points: number;
    salonId: string;
    thresholds: TierThresholds;
    description: string;
  }
): Promise<number> {
  if (points <= 0) return 0;
  const loyaltyPoints = await tx.loyaltyPoints.findUnique({ where: { clientId: invoice.sale.clientId } });
  if (!loyaltyPoints) return 0;

  const newBalance = Math.max(0, loyaltyPoints.balance - points);
  const taken = loyaltyPoints.balance - newBalance;
  if (taken === 0) return 0; // nothing left on the balance: no change, and no history row
  await tx.loyaltyPoints.update({
    where: { clientId: invoice.sale.clientId },
    data: { balance: newBalance, tier: calculateTier(newBalance, thresholds) },
  });
  await tx.loyaltyTransaction.create({
    data: {
      salonId,
      clientId: invoice.sale.clientId,
      saleId: invoice.saleId,
      points: -taken, // what actually came off, so the history always adds up to the balance
      type: LoyaltyTransactionType.ADJUSTMENT,
      description,
    },
  });
  return taken;
}

/** Put every product sold on this bill back into stock. */
async function restoreStock(tx: Prisma.TransactionClient, invoice: RefundableInvoice): Promise<void> {
  for (const item of invoice.sale.items) {
    if (item.productId) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
  }
}

/** Stop the sale's points of these kinds from expiring later: once they have been taken back, an
 *  expiry would take them off the balance a second time. */
async function stopExpiry(
  tx: Prisma.TransactionClient,
  invoice: RefundableInvoice,
  types: LoyaltyTransactionType[]
): Promise<void> {
  await tx.loyaltyTransaction.updateMany({
    where: { saleId: invoice.saleId, type: { in: types }, expiresAt: { not: null } },
    data: { expiresAt: null },
  });
}

/** Why a whole sale is being undone: the bill was cancelled, or fully refunded. */
type UndoReason = "cancelled" | "refunded";

/** Put `points` the client spent on this bill back on their balance, re-tier them, and record why. */
async function givePointsBack(
  tx: Prisma.TransactionClient,
  { invoice, points, why, salonId, thresholds }: {
    invoice: RefundableInvoice;
    points: number;
    why: UndoReason;
    salonId: string;
    thresholds: TierThresholds;
  }
): Promise<number> {
  if (points <= 0) return 0;
  const loyaltyPoints = await tx.loyaltyPoints.findUnique({ where: { clientId: invoice.sale.clientId } });
  if (!loyaltyPoints) return 0; // spending points always leaves a points record, so this is defensive
  const newBalance = loyaltyPoints.balance + points;
  await tx.loyaltyPoints.update({
    where: { clientId: invoice.sale.clientId },
    data: { balance: newBalance, tier: calculateTier(newBalance, thresholds) },
  });
  await tx.loyaltyTransaction.create({
    data: {
      salonId,
      clientId: invoice.sale.clientId,
      saleId: invoice.saleId,
      points,
      type: LoyaltyTransactionType.ADJUSTMENT,
      description: `Points returned: invoice ${invoice.invoiceNumber} ${why}`,
    },
  });
  return points;
}

export interface UndoneSale {
  pointsTaken: number; // earned and birthday-bonus points actually taken off the balance
  pointsReturned: number; // points the client had spent on the bill, put back on their balance
}

interface UndoSaleInput {
  invoice: RefundableInvoice;
  /** Earned points taken back by refunds so far, including one made as part of this cancel. */
  pointsAlreadyReversed: number;
  /** Give back the points the client spent on this bill. */
  returnSpentPoints: boolean;
  salonId: string;
  thresholds: TierThresholds;
}

/**
 * Undo what a cancelled bill gave out, inside the cancel's transaction: take back every loyalty point
 * it earned that no refund has already taken back, plus any birthday bonus it triggered, and put its
 * products back in stock. Runs whether the money paid was refunded or kept. Points the client spent
 * on the bill go back to them when `returnSpentPoints` is set (the money was refunded, or none was
 * paid); when the salon keeps the money, the spent points stay spent too. (A cancel whose own refund
 * was a full one skips this: that refund already undid the sale.)
 */
export async function undoCancelledSale(tx: Prisma.TransactionClient, input: UndoSaleInput): Promise<UndoneSale> {
  return undoSale(tx, { ...input, why: "cancelled" });
}

/** Undo a whole sale's points and stock (a cancel, or a full refund): see undoCancelledSale. */
async function undoSale(
  tx: Prisma.TransactionClient,
  { invoice, pointsAlreadyReversed, returnSpentPoints, why, salonId, thresholds }: UndoSaleInput & {
    why: UndoReason;
  }
): Promise<UndoneSale> {
  // Spent points go back first, so taking back the earned ones can't be cut short by a balance the
  // client had just spent down on this very bill.
  const pointsReturned = returnSpentPoints
    ? await givePointsBack(tx, { invoice, points: salePoints(invoice, LoyaltyTransactionType.REDEEMED), why, salonId, thresholds })
    : 0;
  const earned = salePoints(invoice, LoyaltyTransactionType.EARNED);
  const bonus = salePoints(invoice, LoyaltyTransactionType.BONUS);
  const points = Math.max(0, earned - pointsAlreadyReversed) + bonus;
  const pointsTaken = await takeBackPoints(tx, {
    invoice,
    points,
    salonId,
    thresholds,
    description:
      why === "cancelled"
        ? `Points reversed: invoice ${invoice.invoiceNumber} cancelled`
        : `Points reversed due to refund on invoice ${invoice.invoiceNumber}`,
  });
  await stopExpiry(tx, invoice, [LoyaltyTransactionType.EARNED, LoyaltyTransactionType.BONUS]);
  // Only once the bonus really came off: a client who had already spent it lost nothing here, so they
  // don't get a second bonus that year.
  if (bonus > 0 && pointsTaken >= points) await reopenBirthdayBonus(tx, invoice, why);
  await restoreStock(tx, invoice);
  return { pointsTaken, pointsReturned };
}

/** Checkout gives one birthday bonus a year, found by its description ("Birthday bonus 2026"). Once a
 *  cancel or full refund has taken this bill's bonus back, rename it so the client can still get one
 *  that year. */
async function reopenBirthdayBonus(
  tx: Prisma.TransactionClient,
  invoice: RefundableInvoice,
  why: UndoReason
): Promise<void> {
  for (const row of invoice.sale.loyaltyTransactions) {
    const label = row.description ?? "Bonus";
    // An expired bonus was already lost to expiry, not taken back here: it stays counted.
    if (row.type !== LoyaltyTransactionType.BONUS || row.expiredAt || label.includes("(reversed")) continue;
    await tx.loyaltyTransaction.update({
      where: { id: row.id },
      data: { description: `${label} (reversed: invoice ${invoice.invoiceNumber} ${why})` },
    });
  }
}
