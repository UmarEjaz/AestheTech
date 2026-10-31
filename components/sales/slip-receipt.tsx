import type { ReactElement } from "react";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import { RECEIPT_CONTENT_WIDTH, type ReceiptSize } from "@/lib/constants/receipt-sizes";
import { clientLabel, discountLabel, receiptFigures, receiptStatusLabel, type ReceiptData } from "./receipt-model";
import { Divider, Row } from "./receipt-parts";

/** The narrow monospace receipt for thermal till-roll printers (80mm / 58mm). */
export function SlipReceipt({ data, size }: { data: ReceiptData; size: ReceiptSize }): ReactElement {
  const money = (n: number): string => formatCurrency(n, data.currencyCode);
  const { balanceDue, amountRefunded, loyaltyValue, pointsEarned, pointsBalance, showLoyalty } = receiptFigures(data);

  return (
    <div
      className="receipt mx-auto max-w-full bg-white p-3 font-mono text-[11px] leading-tight text-black"
      style={{ width: RECEIPT_CONTENT_WIDTH[size] }}
    >
      {/* Header */}
      <div className="text-center">
        {data.salonLogo && (
          // eslint-disable-next-line @next/next/no-img-element -- print overlay, not a routed page image
          <img src={data.salonLogo} alt="" className="mx-auto mb-1 h-10 w-auto object-contain" />
        )}
        <div className="text-sm font-bold uppercase tracking-wide">{data.salonName}</div>
        {data.salonAddress && <div>{data.salonAddress}</div>}
        {data.salonPhone && <div>{data.salonPhone}</div>}
        {data.salonEmail && <div>{data.salonEmail}</div>}
        {data.taxNumber && <div>Tax Reg. No. {data.taxNumber}</div>}
      </div>

      <Divider />

      {/* Meta */}
      <div className="space-y-0.5">
        <Row label="Receipt" value={data.receiptNumber} />
        <Row label="Date" value={formatInTz(new Date(data.dateISO), "MMM d, yyyy h:mm a", data.timezone)} />
        <Row label="Customer" value={clientLabel(data.client)} />
      </div>

      <Divider />

      {/* Items */}
      <div className="space-y-1">
        {data.items.map((item, i) => {
          // Line total is GROSS (price × qty); the per-line discount is shown as its own note and is
          // already included in the whole-bill Discount below, so Subtotal − Discount + Tax foots.
          const lineTotal = item.price * item.quantity;
          return (
            <div key={i}>
              <div className="flex justify-between gap-2">
                {/* Wrap (don't truncate) so long item names print in full on the thermal slip — the
                    PDF already wraps, and a clipped name on the customer's receipt loses information. */}
                <span className="min-w-0 break-words">
                  {item.quantity > 1 ? `${item.quantity}× ` : ""}
                  {item.name}
                </span>
                <span className="whitespace-nowrap tabular-nums">{money(lineTotal)}</span>
              </div>
              {item.staffName && <div className="text-[10px] opacity-80">with {item.staffName}</div>}
              {item.discount > 0 && (
                <div className="flex justify-between text-[10px] opacity-80">
                  <span>Item discount</span>
                  <span className="tabular-nums">−{money(item.discount)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Divider />

      {/* Totals */}
      <div className="space-y-0.5">
        <Row label="Subtotal" value={money(data.subtotal)} />
        {data.discount > 0 && <Row label={discountLabel(data)} value={`−${money(data.discount)}`} />}
        {loyaltyValue > 0 && <Row label="Loyalty (points)" value={`−${money(loyaltyValue)}`} />}
        {data.tax > 0 && <Row label="Tax" value={money(data.tax)} />}
        <div className="mt-1 flex justify-between border-t border-black pt-1 text-sm font-bold">
          <span>Total</span>
          <span className="tabular-nums">{money(data.total)}</span>
        </div>
      </div>

      {/* Payment + balance */}
      <Divider />
      <div className="space-y-0.5">
        {data.payments.map((p, i) => (
          <Row
            key={i}
            label={PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? String(p.method)}
            value={money(p.amount)}
          />
        ))}
        {data.payments.length > 0 && <Row label="Total Paid" value={money(data.amountPaid)} />}
        {amountRefunded > 0 && <Row label="Refunded" value={`−${money(amountRefunded)}`} />}
        {balanceDue > 0 && (
          <div className="flex justify-between font-bold">
            <span>Balance Due</span>
            <span className="tabular-nums">{money(balanceDue)}</span>
          </div>
        )}
      </div>

      <Divider />
      {/* Honest status so an unpaid/partial/refunded sale never reads as a clean paid sale. */}
      <div className="text-center font-bold uppercase">{`*** ${receiptStatusLabel(data)} ***`}</div>

      {/* Loyalty — informational only, not part of the money totals above. */}
      {showLoyalty && (
        <>
          <Divider />
          <div className="space-y-0.5">
            {pointsEarned > 0 && <Row label="Points earned" value={`+${pointsEarned}`} />}
            {pointsBalance != null && <Row label="Points balance" value={String(pointsBalance)} />}
          </div>
        </>
      )}

      <Divider />

      <div className="text-center">Thank you for your visit!</div>
      {data.footerNote && (
        <div className="mt-1 whitespace-pre-line text-center text-[10px] opacity-80">{data.footerNote}</div>
      )}
    </div>
  );
}
