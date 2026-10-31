// No "use client": react-pdf components use no browser-only APIs, so this renders both in the client
// download button (via pdf()) and server-side for email attachments (via renderToBuffer()).
import type { ReactElement } from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import { RECEIPT_PDF_WIDTH_PT } from "@/lib/constants/receipt-sizes";
import { clientLabel, discountLabel, receiptFigures, receiptStatusLabel, type ReceiptData } from "./receipt-model";
import { estimateSlipHeight } from "./receipt-geometry";

export type SlipSize = "THERMAL_80" | "THERMAL_58";

const slip = StyleSheet.create({
  page: { paddingVertical: 14, paddingHorizontal: 12, fontSize: 8, fontFamily: "Courier", color: "#000" },
  center: { textAlign: "center" },
  logo: { width: 40, height: 40, alignSelf: "center", marginBottom: 4 },
  salonName: { fontSize: 12, fontFamily: "Courier-Bold", textAlign: "center" },
  muted: { textAlign: "center", fontSize: 7 },
  divider: { borderTopWidth: 1, borderTopColor: "#000", borderStyle: "dashed", marginVertical: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 },
  rowLabel: { flex: 1, paddingRight: 6 },
  rowValue: { textAlign: "right" },
  bold: { fontFamily: "Courier-Bold" },
  sub: { fontSize: 7, color: "#333" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  totalText: { fontSize: 11, fontFamily: "Courier-Bold" },
});

/** Thermal-slip PDF (80mm / 58mm): a variable-height page sized to the content, like a till roll. */
export function SlipReceiptPDF({ data, size }: { data: ReceiptData; size: SlipSize }): ReactElement {
  const money = (n: number): string => formatCurrency(n, data.currencyCode);
  const { balanceDue, amountRefunded, loyaltyValue, pointsEarned, pointsBalance, showLoyalty } = receiptFigures(data);

  return (
    <Document title={`Receipt ${data.receiptNumber}`}>
      <Page size={[RECEIPT_PDF_WIDTH_PT[size], estimateSlipHeight(data, size)]} style={slip.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
        {data.salonLogo ? <Image style={slip.logo} src={data.salonLogo} /> : null}
        <Text style={slip.salonName}>{data.salonName}</Text>
        {data.salonAddress ? <Text style={slip.muted}>{data.salonAddress}</Text> : null}
        {data.salonPhone ? <Text style={slip.muted}>{data.salonPhone}</Text> : null}
        {data.salonEmail ? <Text style={slip.muted}>{data.salonEmail}</Text> : null}
        {data.taxNumber ? <Text style={slip.muted}>Tax Reg. No. {data.taxNumber}</Text> : null}

        <View style={slip.divider} />

        <SlipRow label="Receipt" value={data.receiptNumber} />
        <SlipRow label="Date" value={formatInTz(new Date(data.dateISO), "MMM d, yyyy h:mm a", data.timezone)} />
        <SlipRow label="Customer" value={clientLabel(data.client)} />

        <View style={slip.divider} />

        {data.items.map((item, i) => {
          const lineTotal = item.price * item.quantity; // gross; item discount shown separately
          return (
            <View key={i}>
              <View style={slip.row}>
                <Text style={slip.rowLabel}>
                  {item.quantity > 1 ? `${item.quantity}x ` : ""}
                  {item.name}
                </Text>
                <Text style={slip.rowValue}>{money(lineTotal)}</Text>
              </View>
              {item.staffName ? <Text style={slip.sub}>with {item.staffName}</Text> : null}
              {item.discount > 0 ? (
                <View style={slip.row}>
                  <Text style={[slip.rowLabel, slip.sub]}>Item discount</Text>
                  <Text style={[slip.rowValue, slip.sub]}>-{money(item.discount)}</Text>
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={slip.divider} />

        <SlipRow label="Subtotal" value={money(data.subtotal)} />
        {data.discount > 0 ? <SlipRow label={discountLabel(data)} value={`-${money(data.discount)}`} /> : null}
        {loyaltyValue > 0 ? <SlipRow label="Loyalty (points)" value={`-${money(loyaltyValue)}`} /> : null}
        {data.tax > 0 ? <SlipRow label="Tax" value={money(data.tax)} /> : null}
        <View style={slip.totalRow}>
          <Text style={slip.totalText}>Total</Text>
          <Text style={slip.totalText}>{money(data.total)}</Text>
        </View>

        <View style={slip.divider} />
        {data.payments.map((p, i) => (
          <SlipRow
            key={i}
            label={PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? String(p.method)}
            value={money(p.amount)}
          />
        ))}
        {data.payments.length > 0 ? <SlipRow label="Total Paid" value={money(data.amountPaid)} /> : null}
        {amountRefunded > 0 ? <SlipRow label="Refunded" value={`-${money(amountRefunded)}`} /> : null}
        {balanceDue > 0 ? (
          <View style={slip.row}>
            <Text style={[slip.rowLabel, slip.bold]}>Balance Due</Text>
            <Text style={[slip.rowValue, slip.bold]}>{money(balanceDue)}</Text>
          </View>
        ) : null}

        <View style={slip.divider} />
        <Text style={[slip.center, slip.bold]}>{`*** ${receiptStatusLabel(data)} ***`}</Text>

        {/* Loyalty — informational only, not part of the money totals above. */}
        {showLoyalty ? (
          <View>
            <View style={slip.divider} />
            {pointsEarned > 0 ? <SlipRow label="Points earned" value={`+${pointsEarned}`} /> : null}
            {pointsBalance != null ? <SlipRow label="Points balance" value={String(pointsBalance)} /> : null}
          </View>
        ) : null}

        <View style={slip.divider} />
        <Text style={slip.center}>Thank you for your visit!</Text>
        {data.footerNote ? <Text style={[slip.center, slip.sub, { marginTop: 4 }]}>{data.footerNote}</Text> : null}
      </Page>
    </Document>
  );
}

function SlipRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View style={slip.row}>
      <Text style={slip.rowLabel}>{label}</Text>
      <Text style={slip.rowValue}>{value}</Text>
    </View>
  );
}
