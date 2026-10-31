import type { ReactElement } from "react";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import {
  RECEIPT_CONTENT_WIDTH,
  DEFAULT_RECEIPT_SIZE,
  receiptFamily,
  type ReceiptSize,
} from "@/lib/constants/receipt-sizes";
import { clientLabel, paymentStatus } from "./receipt-model";
import { Divider, Row } from "./receipt-parts";

// Proof of ONE payment made against an invoice (deposit / partial / pay-later), with the running
// balance. Distinct from the sale receipt (which is the full itemized proof of the whole sale).
export interface PaymentReceiptData {
  invoiceNumber: string;
  paymentDateISO: string;
  timezone: string;
  currencyCode: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  taxNumber?: string | null; // business tax/VAT/GST registration number, as on the sale receipt
  footerNote?: string | null; // optional terms/footer note, as on the sale receipt
  client: { firstName: string; lastName: string | null; isWalkIn?: boolean };
  method: string; // a PaymentMethod value; string so stored data always renders
  amount: number; // this payment
  invoiceTotal: number;
  totalPaid: number; // cumulative, including this payment
  size?: ReceiptSize; // paper size chosen in Settings; absent → thermal 80mm slip
}

/** Print-optimized single-payment receipt. Narrow slip for thermal rolls (80/58mm) or a wider A5/A4
 *  sheet, matching the salon's Receipt-size setting. Rendered by PaymentReceiptButton for print. */
export function PaymentReceipt({ data }: { data: PaymentReceiptData }): ReactElement {
  const size = data.size ?? DEFAULT_RECEIPT_SIZE;
  const isDocument = receiptFamily(size) === "document";
  const money = (n: number): string => formatCurrency(n, data.currencyCode);
  // Same cent-rounded, clamped balance as the sale receipt and the invoice PDF, so sub-cent float drift
  // can't print "Balance Due $0.00" next to "Partial payment received".
  const { balanceDue: balance } = paymentStatus(data.invoiceTotal, data.totalPaid);

  return (
    <div
      className={
        isDocument
          ? "receipt mx-auto max-w-full bg-white p-6 text-[12px] leading-relaxed text-black"
          : "receipt mx-auto max-w-full bg-white p-3 font-mono text-[11px] leading-tight text-black"
      }
      style={{ width: RECEIPT_CONTENT_WIDTH[size] }}
    >
      <div className="text-center">
        <div className={isDocument ? "text-xl font-bold uppercase tracking-wide" : "text-sm font-bold uppercase tracking-wide"}>
          {data.salonName}
        </div>
        {data.salonAddress && <div className={isDocument ? "text-[11px] text-neutral-600" : undefined}>{data.salonAddress}</div>}
        {data.salonPhone && <div className={isDocument ? "text-[11px] text-neutral-600" : undefined}>{data.salonPhone}</div>}
        {data.salonEmail && <div className={isDocument ? "text-[11px] text-neutral-600" : undefined}>{data.salonEmail}</div>}
        {data.taxNumber && (
          <div className={isDocument ? "text-[11px] text-neutral-600" : undefined}>Tax Reg. No. {data.taxNumber}</div>
        )}
      </div>

      <Divider doc={isDocument} />
      <div className={isDocument ? "text-center text-base font-bold uppercase tracking-wide" : "text-center text-xs font-bold uppercase"}>
        Payment Receipt
      </div>
      <Divider doc={isDocument} />

      <div className="space-y-0.5">
        <Row label="Invoice" value={data.invoiceNumber} />
        <Row label="Date" value={formatInTz(new Date(data.paymentDateISO), "MMM d, yyyy h:mm a", data.timezone)} />
        <Row label="Customer" value={clientLabel(data.client)} />
        <Row
          label="Method"
          value={PAYMENT_METHOD_LABELS[data.method as PaymentMethod] ?? String(data.method)}
        />
      </div>

      <div className={`mt-2 flex justify-between border-t border-black pt-1 font-bold ${isDocument ? "text-base" : "text-sm"}`}>
        <span>Amount Paid</span>
        <span className="tabular-nums">{money(data.amount)}</span>
      </div>

      <Divider doc={isDocument} />

      <div className="space-y-0.5">
        <Row label="Invoice Total" value={money(data.invoiceTotal)} />
        <Row label="Total Paid" value={money(data.totalPaid)} />
        <div className="flex justify-between font-bold">
          <span>{balance > 0 ? "Balance Due" : "Balance"}</span>
          <span className="tabular-nums">{money(balance)}</span>
        </div>
      </div>

      <Divider doc={isDocument} />
      <div className="text-center">
        {balance > 0 ? "Partial payment received — thank you!" : "Paid in full — thank you!"}
      </div>
      {data.footerNote && (
        <div className="mt-1 whitespace-pre-line text-center text-[10px] opacity-80">{data.footerNote}</div>
      )}
    </div>
  );
}
