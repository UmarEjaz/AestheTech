import type { ReactElement } from "react";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import { RECEIPT_CONTENT_WIDTH, type ReceiptSize } from "@/lib/constants/receipt-sizes";
import { clientLabel, discountLabel, receiptFigures, receiptStatusLabel, type ReceiptData } from "./receipt-model";
import { DocMeta, Row } from "./receipt-parts";

/** The wider document-style receipt, with a bordered items table, for A5 / A4 regular paper. */
export function DocumentReceipt({ data, size }: { data: ReceiptData; size: ReceiptSize }): ReactElement {
  const money = (n: number): string => formatCurrency(n, data.currencyCode);
  const { balanceDue, amountRefunded, loyaltyValue, pointsEarned, pointsBalance, showLoyalty } = receiptFigures(data);

  return (
    <div
      className="receipt mx-auto max-w-full bg-white p-6 text-[12px] leading-relaxed text-black"
      style={{ width: RECEIPT_CONTENT_WIDTH[size] }}
    >
      {/* Header */}
      <div className="text-center">
        {data.salonLogo && (
          // eslint-disable-next-line @next/next/no-img-element -- print overlay, not a routed page image
          <img src={data.salonLogo} alt="" className="mx-auto mb-2 h-14 w-auto object-contain" />
        )}
        <div className="text-xl font-bold uppercase tracking-wide">{data.salonName}</div>
        {data.salonAddress && <div className="text-[11px] text-neutral-600">{data.salonAddress}</div>}
        {(data.salonPhone || data.salonEmail) && (
          <div className="text-[11px] text-neutral-600">
            {[data.salonPhone, data.salonEmail].filter(Boolean).join("  ·  ")}
          </div>
        )}
        {data.taxNumber && <div className="text-[11px] text-neutral-600">Tax Reg. No. {data.taxNumber}</div>}
      </div>

      <div className="my-4 border-t border-neutral-300" />

      {/* Bill-to + receipt meta, two columns */}
      <div className="flex justify-between gap-6">
        <div className="space-y-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Billed to</div>
          <div className="font-semibold">{clientLabel(data.client)}</div>
        </div>
        <div className="space-y-0.5 text-right">
          <DocMeta label="Receipt #" value={data.receiptNumber} />
          <DocMeta label="Date" value={formatInTz(new Date(data.dateISO), "MMM d, yyyy h:mm a", data.timezone)} />
        </div>
      </div>

      {/* Items table */}
      <table className="mt-4 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-y border-neutral-400 text-left">
            <th scope="col" className="py-1 pr-2 font-semibold">Description</th>
            <th scope="col" className="py-1 px-2 text-right font-semibold">Rate</th>
            <th scope="col" className="py-1 px-2 text-right font-semibold">Qty</th>
            <th scope="col" className="py-1 pl-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, i) => {
            // Gross line total (see slip layout note); item discount shown in its own sub-line.
            const lineTotal = item.price * item.quantity;
            return (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="py-1.5 pr-2">
                  <div>{item.name}</div>
                  {item.staffName && <div className="text-[10px] text-neutral-500">with {item.staffName}</div>}
                  {item.discount > 0 && (
                    <div className="text-[10px] text-neutral-500">Item discount −{money(item.discount)}</div>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{money(item.price)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{item.quantity}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{money(lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals, right-aligned block */}
      <div className="mt-4 flex justify-end">
        <div className="w-56 space-y-0.5">
          <Row label="Subtotal" value={money(data.subtotal)} />
          {data.discount > 0 && <Row label={discountLabel(data)} value={`−${money(data.discount)}`} />}
          {loyaltyValue > 0 && <Row label="Loyalty (points)" value={`−${money(loyaltyValue)}`} />}
          {data.tax > 0 && <Row label="Tax" value={money(data.tax)} />}
          <div className="mt-1 flex justify-between border-t border-neutral-400 pt-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{money(data.total)}</span>
          </div>
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
      </div>

      {/* Status + thanks */}
      <div className="mt-5 text-center text-sm font-bold uppercase tracking-wide">{`*** ${receiptStatusLabel(data)} ***`}</div>
      {/* Loyalty — informational only, not part of the money totals above. */}
      {showLoyalty && (
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          {pointsEarned > 0 && <div>Points earned: +{pointsEarned}</div>}
          {pointsBalance != null && <div>Points balance: {pointsBalance}</div>}
        </div>
      )}
      <div className="mt-2 text-center text-[11px] text-neutral-600">Thank you for your visit!</div>
      {data.footerNote && (
        <div className="mt-1 whitespace-pre-line text-center text-[10px] text-neutral-500">{data.footerNote}</div>
      )}
    </div>
  );
}
