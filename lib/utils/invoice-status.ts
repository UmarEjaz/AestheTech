import type { InvoiceStatus } from "@prisma/client";
import { roundCents } from "./currency";

/** Statuses that still owe money (and so can become overdue). */
const OUTSTANDING: InvoiceStatus[] = ["PENDING", "PARTIALLY_PAID"];

/**
 * Whether an invoice is overdue. Overdue is DERIVED on read (not stored): an
 * outstanding invoice whose due date has passed. This avoids needing a scheduled
 * job to flip statuses.
 */
export function isInvoiceOverdue(
  status: InvoiceStatus,
  dueDate: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!OUTSTANDING.includes(status)) return false;
  if (!dueDate) return false;
  return new Date(dueDate) < now;
}

/** The status to DISPLAY — OVERDUE when derived-overdue, otherwise the stored status. */
export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: Date | string | null | undefined,
  now: Date = new Date()
): InvoiceStatus {
  return isInvoiceOverdue(status, dueDate, now) ? "OVERDUE" : status;
}

/** Remaining balance owed on an invoice. Accepts number/string/Prisma Decimal amounts. */
export function amountDue(
  total: number,
  payments: { amount: number | string | { toString(): string } }[]
): number {
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return Math.max(0, roundCents(total - paid));
}

/** Money paid and not given back, cent-rounded and never below zero. The invoice page sends this figure
 *  with a cancel and the server recomputes it, so both must use this one function or the cancel is refused. */
export function netPaid(paid: number, refunded: number): number {
  return Math.max(0, roundCents(paid - refunded));
}

/** Refunds that took money back off the bill: refunds less any change handed back at checkout on an
 *  overpaid deposit (that change was never part of the bill). */
export function refundedOffBill(total: number, paid: number, refunded: number): number {
  return Math.max(0, roundCents(refunded - Math.max(0, paid - total)));
}

/** How much of a paid bill can still be refunded. The refund action and both pages use this one rule
 *  (and the reports its refundedOffBill part), so they always agree. */
export function refundableLeft(total: number, paid: number, refunded: number): number {
  return Math.max(0, roundCents(total - refundedOffBill(total, paid, refunded)));
}

/** Human label for a status, e.g. "PARTIALLY_PAID" → "Partially Paid". */
export function formatInvoiceStatus(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** Badge colour for a status, the same on every page: green paid, amber while money is owed, red overdue,
 *  grey for cancelled/refunded. */
export function invoiceStatusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "PAID":
      return "success";
    case "PENDING":
    case "PARTIALLY_PAID":
      return "warning";
    case "OVERDUE":
      return "destructive";
    default:
      return "secondary"; // CANCELLED, REFUNDED
  }
}
