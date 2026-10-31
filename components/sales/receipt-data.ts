import type { ReceiptSize } from "@/lib/constants/receipt-sizes";
import type { InvoicePDFData } from "@/components/invoices/invoice-pdf";
import type { ReceiptData } from "./receipt-model";
import type { SaleLoyaltySummary } from "@/lib/sale-loyalty-summary";

// Pure mappers from a loaded sale to the flat data the receipt / invoice renderers take. Shared by the
// sale detail page and the receipt / invoice email actions, so the three never drift apart. Inputs are
// typed structurally (just the fields read), so any Prisma query that selects at least these fits.

/** A number, numeric string or Prisma Decimal (anything with `toFixed`); always read through `Number()`. */
export type AmountLike = number | string | { toFixed(): string };

export interface ReceiptSaleItem {
  price: AmountLike;
  quantity: number;
  discount: AmountLike;
  service: { name: string } | null;
  staff: { firstName: string; lastName: string } | null;
  product: { name: string } | null;
}

interface InvoiceCore {
  invoiceNumber: string;
  status: string;
  tax: AmountLike;
  total: AmountLike;
  refunds: Array<{ amount: AmountLike }>;
}

/** What the sale receipt needs from a sale. */
export interface ReceiptSale {
  createdAt: Date;
  totalAmount: AmountLike;
  discount: AmountLike;
  client: { firstName: string; lastName: string | null; isWalkIn: boolean };
  items: ReceiptSaleItem[];
  invoice: (InvoiceCore & { refundedAt: Date | null; payments: Array<{ method: string; amount: AmountLike }> }) | null;
}

/** What the invoice PDF needs from a sale (contact details and per-line ids/notes on top). */
export interface InvoiceSale {
  createdAt: Date;
  totalAmount: AmountLike;
  discount: AmountLike;
  client: { firstName: string; lastName: string | null; email: string | null; phone: string | null; isWalkIn: boolean };
  items: Array<ReceiptSaleItem & { id: string; note: string | null }>;
  invoice: (InvoiceCore & { payments: Array<{ amount: AmountLike }> }) | null;
}

/** The salon settings a receipt or invoice prints (a subset of SettingsData; pages may pass a fallback). */
export interface ReceiptSettings {
  currencyCode: string;
  timezone: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  salonLogo: string | null;
  taxRate: number;
  taxNumber: string | null;
  receiptFooter: string | null;
  receiptSize: ReceiptSize;
}

/** "No loyalty figures" (program off, or a walk-in). Frozen: it is shared as a default argument. */
export const NO_LOYALTY: Readonly<SaleLoyaltySummary> = Object.freeze({ pointsEarned: 0, pointsBalance: null });

/** Sum of Prisma Decimal / numeric amounts, as a plain number. */
export const sumAmounts = (rows: ReadonlyArray<{ amount: AmountLike }>): number =>
  rows.reduce((s, r) => s + Number(r.amount), 0);

export interface InvoicePdfOptions {
  /** Loyalty figures for the "Points Earned" box; omit when the program is off or the client is a walk-in. */
  loyalty?: Readonly<SaleLoyaltySummary>;
  /** The status to print (e.g. the derived OVERDUE); defaults to the stored invoice status. */
  status?: string;
  /** The invoice date to print; defaults to the sale's creation time (the invoice is created with it). */
  createdAt?: Date;
}

/** Invoice-PDF data for a sale that has an invoice; `null` before invoicing. */
export function buildSaleInvoicePdfData(
  sale: InvoiceSale,
  settings: ReceiptSettings,
  { loyalty = NO_LOYALTY, status, createdAt }: InvoicePdfOptions = {}
): InvoicePDFData | null {
  if (!sale.invoice) return null;
  return {
    invoiceNumber: sale.invoice.invoiceNumber,
    status: status ?? sale.invoice.status,
    createdAt: (createdAt ?? sale.createdAt).toISOString(),
    salonName: settings.salonName,
    salonAddress: settings.salonAddress,
    salonPhone: settings.salonPhone,
    salonEmail: settings.salonEmail,
    salonLogo: settings.salonLogo,
    currencyCode: settings.currencyCode,
    taxRate: settings.taxRate,
    taxNumber: settings.taxNumber,
    footerNote: settings.receiptFooter,
    timezone: settings.timezone,
    client: {
      firstName: sale.client.firstName,
      lastName: sale.client.lastName,
      email: sale.client.email,
      phone: sale.client.phone,
      isWalkIn: sale.client.isWalkIn,
    },
    items: sale.items.map((item) => ({
      id: item.id,
      service: item.service ? { name: item.service.name } : null,
      staff: item.staff ? { firstName: item.staff.firstName, lastName: item.staff.lastName } : null,
      product: item.product ? { name: item.product.name } : null,
      price: Number(item.price),
      quantity: item.quantity,
      discount: Number(item.discount),
      note: item.note ?? null,
    })),
    subtotal: Number(sale.totalAmount),
    discount: Number(sale.discount),
    tax: Number(sale.invoice.tax),
    total: Number(sale.invoice.total),
    amountPaid: sumAmounts(sale.invoice.payments),
    amountRefunded: sumAmounts(sale.invoice.refunds),
    loyaltyPointsEarned: loyalty.pointsEarned,
  };
}

/** Compact proof-of-payment receipt for printing/reprinting; `null` until the sale is invoiced. */
export function buildSaleReceiptData(
  sale: ReceiptSale,
  settings: ReceiptSettings,
  loyalty: Readonly<SaleLoyaltySummary> = NO_LOYALTY
): ReceiptData | null {
  if (!sale.invoice) return null;
  return {
    receiptNumber: sale.invoice.invoiceNumber,
    dateISO: sale.createdAt.toISOString(),
    timezone: settings.timezone,
    currencyCode: settings.currencyCode,
    salonName: settings.salonName,
    salonAddress: settings.salonAddress,
    salonPhone: settings.salonPhone,
    salonEmail: settings.salonEmail,
    salonLogo: settings.salonLogo,
    taxNumber: settings.taxNumber,
    footerNote: settings.receiptFooter,
    client: {
      firstName: sale.client.firstName,
      lastName: sale.client.lastName,
      isWalkIn: sale.client.isWalkIn,
    },
    items: sale.items.map((item) => ({
      name: item.service?.name ?? item.product?.name ?? "Item",
      staffName: item.staff ? `${item.staff.firstName} ${item.staff.lastName}` : null,
      quantity: item.quantity,
      price: Number(item.price),
      discount: Number(item.discount),
    })),
    subtotal: Number(sale.totalAmount),
    discount: Number(sale.discount),
    tax: Number(sale.invoice.tax),
    total: Number(sale.invoice.total),
    payments: sale.invoice.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    amountPaid: sumAmounts(sale.invoice.payments),
    refunded: sale.invoice.status === "REFUNDED" || Boolean(sale.invoice.refundedAt),
    amountRefunded: sumAmounts(sale.invoice.refunds),
    pointsEarned: loyalty.pointsEarned,
    pointsBalance: loyalty.pointsBalance,
    size: settings.receiptSize,
  };
}
