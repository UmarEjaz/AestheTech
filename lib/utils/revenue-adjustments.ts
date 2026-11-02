import { roundCents } from "./currency";
import { refundedOffBill } from "./invoice-status";

// Refunds and cancellations change what a sale is worth after the day it was made. Reports keep each
// sale's revenue on the day it was made and take these changes off on the day they happen, so a month
// that has already been reported never changes afterwards. A kept cancellation fee stays as income:
// only the part never paid (or paid and then given back) comes off.

/** A sold item, as far as an adjustment needs it. */
export interface AdjustableItem {
  price: number;
  quantity: number;
  costAtSale: number | null;
  productId: string | null;
}

/** A bill with everything that happened to its money after the sale. */
export interface AdjustableBill<I extends AdjustableItem> {
  total: number; // the invoice total (tax included): refunds and payments are measured against it
  revenue: number; // the sale's revenue as reports count it (the sale's final amount)
  pointsValue: number; // the part of `revenue` the client paid with loyalty points (not in `total`)
  paid: number; // every payment made on it
  cancelledAt: Date | null;
  refunds: Array<{ amount: number; createdAt: Date }>;
  items: I[];
  clientId: string;
  clientName: string;
}

/** One change to a bill's revenue, on the day it happened. */
export interface Adjustment<I extends AdjustableItem> {
  at: Date;
  share: number; // the fraction of the bill's revenue it takes off (0–1)
  restocked: boolean; // its products went back into stock at this moment, so their cost comes off too
  bill: AdjustableBill<I>;
}

/**
 * The adjustments a bill has had, oldest first:
 * - each refund takes its share of the money part off (the total, tax included, measured against
 *   the revenue the client paid in money). A refund that only hands back an overpaid deposit (change
 *   given at checkout, the bill still fully paid) takes nothing off.
 * - a cancel takes off the money part never paid. Money kept stays as income; money given back at
 *   the cancel is a refund, above.
 * The part paid with points comes off only when the points go back to the client: on a full refund,
 * or on a cancel that keeps no money (the actions' own rules). A part refund leaves them spent.
 * Products come back into stock, and so their cost comes off, on a full refund or on the cancel
 * (whichever is first), matching what the refund and cancel actions do to stock.
 */
export function billAdjustments<I extends AdjustableItem>(bill: AdjustableBill<I>): Adjustment<I>[] {
  if (bill.total <= 0 || bill.revenue <= 0) return [];
  const moneyRevenue = Math.max(0, bill.revenue - bill.pointsValue);
  // The fraction of the bill's revenue that a given slice of the total, plus any points, stands for.
  const shareOf = (ofTotal: number, points: number): number =>
    Math.min(1, ((ofTotal / bill.total) * moneyRevenue + points) / bill.revenue);
  const out: Adjustment<I>[] = [];
  let change = Math.max(0, bill.paid - bill.total);
  let refundedSoFar = 0;
  let restocked = false;
  for (const refund of [...bill.refunds].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const takenOff = Math.max(0, refund.amount - change);
    change = Math.max(0, change - refund.amount);
    refundedSoFar += refund.amount;
    // The refund action's own rule (change handed back on an overpaid deposit doesn't count).
    const fullRefund = !restocked && refundedOffBill(bill.total, bill.paid, refundedSoFar) >= bill.total - 0.01;
    if (fullRefund) restocked = true;
    if (takenOff > 0 || fullRefund) {
      // A full refund also gives back points spent on the bill, so that part comes off too.
      out.push({ at: refund.createdAt, share: shareOf(takenOff, fullRefund ? bill.pointsValue : 0), restocked: fullRefund, bill });
    }
  }
  if (bill.cancelledAt) {
    const neverPaid = Math.max(0, bill.total - bill.paid);
    const keptMoney = bill.paid - refundedSoFar > 0.005;
    // A full refund before the cancel already gave the points back (and the cancel then skips it).
    const pointsBack = !keptMoney && !restocked ? bill.pointsValue : 0;
    out.push({ at: bill.cancelledAt, share: shareOf(neverPaid, pointsBack), restocked: !restocked, bill });
  }
  return out;
}

/** What an adjustment takes off the bill's revenue (a negative number, or 0). */
export function revenueChange<I extends AdjustableItem>(a: Adjustment<I>): number {
  return -roundCents(a.bill.revenue * a.share);
}

/** Each item's part of an adjustment: its revenue share, and its product cost once restocked. */
export function itemChanges<I extends AdjustableItem>(a: Adjustment<I>): Array<{ item: I; revenue: number; cost: number }> {
  return a.bill.items.map((item) => ({
    item,
    revenue: -roundCents(item.price * item.quantity * a.share),
    cost: a.restocked && item.productId && item.costAtSale != null ? -roundCents(item.costAtSale * item.quantity) : 0,
  }));
}

/** What an adjustment takes off the cost of goods sold (a negative number, or 0). */
export function costChange<I extends AdjustableItem>(a: Adjustment<I>): number {
  return itemChanges(a).reduce((sum, c) => sum + c.cost, 0);
}

/** The total of `fn` over the adjustments. */
export function sumOf<I extends AdjustableItem>(adjustments: Adjustment<I>[], fn: (a: Adjustment<I>) => number): number {
  return roundCents(adjustments.reduce((sum, a) => sum + fn(a), 0));
}
