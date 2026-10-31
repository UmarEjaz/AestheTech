import type { ReceiptSize } from "@/lib/constants/receipt-sizes";
import { impliedLoyaltyValue } from "@/lib/utils/receipt-totals";

/** Loyalty-points value redeemed at checkout, derived from the printed figures so the receipt always
 *  foots. Lives in lib/utils/receipt-totals (shared with the invoice PDF); re-exported for receipt callers. */
export { impliedLoyaltyValue };

// Everything a printed customer receipt needs. Kept flat (no Prisma types) so it can be built on the
// server from a Sale and passed to the print button, and rendered/tested in isolation.
export interface ReceiptData {
  receiptNumber: string; // the invoice number, or a sale-based reference
  dateISO: string; // sale.createdAt (UTC instant)
  timezone: string; // salon tz — the receipt shows the salon-local date/time
  currencyCode: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  salonLogo: string | null;
  taxNumber?: string | null; // business tax/VAT/GST registration number, shown under the salon header
  footerNote?: string | null; // optional terms/footer note printed below the thank-you line
  client: { firstName: string; lastName: string | null; isWalkIn?: boolean };
  items: Array<{
    name: string;
    staffName: string | null;
    quantity: number;
    price: number; // unit price
    discount: number; // per-line discount amount
  }>;
  subtotal: number;
  discount: number; // whole-bill discount
  tax: number;
  total: number;
  payments: Array<{ method: string; amount: number }>; // a PaymentMethod value; string so stored data always renders
  amountPaid: number; // sum of payments — drives the paid/balance status so an unpaid sale can't look settled
  refunded: boolean; // fully refunded (invoice status REFUNDED)
  amountRefunded?: number; // money returned so far — a partial refund must not read as a clean sale
  pointsEarned?: number; // loyalty points earned on this sale (informational; not part of the money totals)
  pointsBalance?: number | null; // the client's current points balance (informational); null/undefined hides it
  size?: ReceiptSize; // paper size chosen in Settings; absent → thermal 80mm slip
}

export interface PaymentStatus {
  balanceDue: number;
  label: "PAID" | "PARTIALLY PAID" | "UNPAID";
}

// Round to cents and clamp so tiny float drift can't show a phantom balance.
export function paymentStatus(total: number, amountPaid: number): PaymentStatus {
  const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const label = balanceDue <= 0 ? "PAID" : amountPaid > 0 ? "PARTIALLY PAID" : "UNPAID";
  return { balanceDue, label };
}

/**
 * The banner label printed on the receipt. Refund state takes precedence over paid/unpaid so a
 * refunded or partially-refunded sale never reads as a clean "PAID".
 */
export function receiptStatusLabel(data: ReceiptData): string {
  if (data.refunded) return "REFUNDED";
  const refunded = data.amountRefunded ?? 0;
  const netPaid = data.amountPaid - refunded;
  // Only call it a partial refund when money actually left the till — i.e. the net paid no longer
  // covers the total (same cent rounding as the balance). A refund that merely returns an overpaid
  // deposit (change given; net still equals the total) is a clean paid sale, not "PARTIALLY REFUNDED".
  const net = paymentStatus(data.total, netPaid);
  if (refunded > 0 && net.balanceDue > 0) return "PARTIALLY REFUNDED";
  return net.label;
}

/** "Discount" normally, but names the item discounts when some are folded in, so the single Discount
 *  line doesn't read as double-counting the per-line "Item discount" notes. */
export function discountLabel(data: ReceiptData): string {
  return data.items.some((i) => i.discount > 0) ? "Discount (incl. item discounts)" : "Discount";
}

/** "Walk-in" for an anonymous sale, otherwise the client's full name. */
export function clientLabel(client: ReceiptData["client"]): string {
  return client.isWalkIn ? "Walk-in" : `${client.firstName}${client.lastName ? ` ${client.lastName}` : ""}`;
}

/** Shared per-render figures both receipt layouts print (slip and document, HTML and PDF). */
export interface ReceiptFigures {
  balanceDue: number;
  amountRefunded: number;
  loyaltyValue: number;
  pointsEarned: number;
  pointsBalance: number | null;
  showLoyalty: boolean;
}

export function receiptFigures(data: ReceiptData): ReceiptFigures {
  const { balanceDue } = paymentStatus(data.total, data.amountPaid);
  const pointsEarned = data.pointsEarned ?? 0;
  const pointsBalance = data.pointsBalance ?? null;
  return {
    balanceDue,
    amountRefunded: data.amountRefunded ?? 0,
    loyaltyValue: impliedLoyaltyValue(data),
    pointsEarned,
    pointsBalance,
    showLoyalty: pointsEarned > 0 || pointsBalance != null,
  };
}
