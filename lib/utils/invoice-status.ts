import type { InvoiceStatus } from "@prisma/client";

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
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** Human label for a status, e.g. "PARTIALLY_PAID" → "Partially Paid". */
export function formatInvoiceStatus(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}
