import type { SaleLoyaltySummary } from "@/lib/sale-loyalty-summary";
import type { PaymentReceiptData } from "@/components/sales/payment-receipt";
import {
  NO_LOYALTY,
  sumAmounts,
  type AmountLike,
  type ReceiptSaleItem,
  type ReceiptSettings,
} from "@/components/sales/receipt-data";
import type { InvoicePDFData } from "./invoice-pdf";

// Pure mappers from a loaded invoice to the flat data the PDF / payment-receipt renderers take. Kept
// out of the page so the server component stays a thin loader and the mapping is unit-testable. Inputs
// are typed structurally (just the fields read), so `getInvoice`'s result fits without coupling to it.

/** What the invoice PDF and the per-payment receipts need from a loaded invoice. */
export interface InvoiceForDocuments {
  invoiceNumber: string;
  status: string;
  createdAt: Date;
  tax: AmountLike;
  total: AmountLike;
  client: { firstName: string; lastName: string | null; email: string | null; phone: string | null; isWalkIn: boolean };
  sale: {
    totalAmount: AmountLike;
    discount: AmountLike;
    items: Array<ReceiptSaleItem & { id: string; note: string | null }>;
  };
  /** Oldest first (the running balance on each payment receipt depends on it). */
  payments: Array<{ id: string; amount: AmountLike; method: string; paidAt: Date }>;
  refunds: Array<{ amount: AmountLike }>;
}

export function buildInvoicePdfData(
  invoice: InvoiceForDocuments,
  settings: ReceiptSettings,
  loyalty: Readonly<SaleLoyaltySummary> = NO_LOYALTY
): InvoicePDFData {
  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
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
      firstName: invoice.client.firstName,
      lastName: invoice.client.lastName,
      email: invoice.client.email,
      phone: invoice.client.phone,
      isWalkIn: invoice.client.isWalkIn,
    },
    items: invoice.sale.items.map((item) => ({
      id: item.id,
      service: item.service ? { name: item.service.name } : null,
      staff: item.staff ? { firstName: item.staff.firstName, lastName: item.staff.lastName } : null,
      product: item.product ? { name: item.product.name } : null,
      price: Number(item.price),
      quantity: item.quantity,
      discount: Number(item.discount),
      note: item.note ?? null,
    })),
    subtotal: Number(invoice.sale.totalAmount),
    discount: Number(invoice.sale.discount),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    amountPaid: sumAmounts(invoice.payments),
    amountRefunded: sumAmounts(invoice.refunds),
    loyaltyPointsEarned: loyalty.pointsEarned,
  };
}

/**
 * Per-payment receipt data keyed by payment id, each carrying the running balance AT THE TIME of that
 * payment (payments are ordered oldest-first). Lets staff reprint proof of any single deposit/partial
 * payment.
 */
export function buildPaymentReceipts(invoice: InvoiceForDocuments, settings: ReceiptSettings): Map<string, PaymentReceiptData> {
  let runningPaid = 0;
  return new Map(
    invoice.payments.map((p) => {
      runningPaid += Number(p.amount);
      return [
        p.id,
        {
          invoiceNumber: invoice.invoiceNumber,
          paymentDateISO: p.paidAt.toISOString(),
          timezone: settings.timezone,
          currencyCode: settings.currencyCode,
          salonName: settings.salonName,
          salonAddress: settings.salonAddress,
          salonPhone: settings.salonPhone,
          salonEmail: settings.salonEmail,
          taxNumber: settings.taxNumber,
          footerNote: settings.receiptFooter,
          client: {
            firstName: invoice.client.firstName,
            lastName: invoice.client.lastName,
            isWalkIn: invoice.client.isWalkIn,
          },
          method: p.method,
          amount: Number(p.amount),
          invoiceTotal: Number(invoice.total),
          totalPaid: runningPaid,
          size: settings.receiptSize,
        },
      ];
    })
  );
}
