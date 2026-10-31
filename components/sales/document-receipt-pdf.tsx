// No "use client": react-pdf components use no browser-only APIs, so this renders both in the client
// download button (via pdf()) and server-side for email attachments (via renderToBuffer()).
import type { ReactElement } from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import { RECEIPT_PDF_PAGE_SIZE } from "@/lib/constants/receipt-sizes";
import { clientLabel, discountLabel, receiptFigures, receiptStatusLabel, type ReceiptData } from "./receipt-model";

export type DocumentSize = "A5" | "A4";

const doc = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#000" },
  logo: { width: 56, height: 56, alignSelf: "center", marginBottom: 6, objectFit: "contain" },
  salonName: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "center" },
  muted: { textAlign: "center", fontSize: 9, color: "#555" },
  rule: { borderTopWidth: 1, borderTopColor: "#bbb", marginVertical: 14 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaLabel: { fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 },
  billName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  metaRight: { textAlign: "right" },
  tHead: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#888", paddingVertical: 4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e5e5e5", paddingVertical: 5 },
  cDesc: { flex: 1, paddingRight: 6 },
  cRate: { width: 70, textAlign: "right" },
  cQty: { width: 44, textAlign: "right" },
  cAmt: { width: 76, textAlign: "right" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  sub: { fontSize: 8, color: "#888" },
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totals: { width: 220 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  rowLabel: { color: "#555" },
  bold: { fontFamily: "Helvetica-Bold" },
  totalLine: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: "#888", marginTop: 3, paddingTop: 3 },
  totalText: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  status: { textAlign: "center", fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 18 },
  thanks: { textAlign: "center", fontSize: 9, color: "#555", marginTop: 6 },
});

/** A5 / A4 document-style receipt PDF with a bordered items table, for regular printers. */
export function DocumentReceiptPDF({ data, size }: { data: ReceiptData; size: DocumentSize }): ReactElement {
  const money = (n: number): string => formatCurrency(n, data.currencyCode);
  const { balanceDue, amountRefunded, loyaltyValue, pointsEarned, pointsBalance, showLoyalty } = receiptFigures(data);

  return (
    <Document title={`Receipt ${data.receiptNumber}`}>
      <Page size={RECEIPT_PDF_PAGE_SIZE[size]} style={doc.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
        {data.salonLogo ? <Image style={doc.logo} src={data.salonLogo} /> : null}
        <Text style={doc.salonName}>{data.salonName}</Text>
        {data.salonAddress ? <Text style={doc.muted}>{data.salonAddress}</Text> : null}
        {data.salonPhone || data.salonEmail ? (
          <Text style={doc.muted}>{[data.salonPhone, data.salonEmail].filter(Boolean).join("  ·  ")}</Text>
        ) : null}
        {data.taxNumber ? <Text style={doc.muted}>Tax Reg. No. {data.taxNumber}</Text> : null}

        <View style={doc.rule} />

        <View style={doc.metaRow}>
          <View>
            <Text style={doc.metaLabel}>Billed to</Text>
            <Text style={doc.billName}>{clientLabel(data.client)}</Text>
          </View>
          <View style={doc.metaRight}>
            <Text>
              <Text style={doc.metaLabel}>Receipt # </Text>
              {data.receiptNumber}
            </Text>
            <Text>
              <Text style={doc.metaLabel}>Date </Text>
              {formatInTz(new Date(data.dateISO), "MMM d, yyyy h:mm a", data.timezone)}
            </Text>
          </View>
        </View>

        {/* Items table */}
        <View style={{ marginTop: 14 }}>
          <View style={doc.tHead}>
            <Text style={[doc.cDesc, doc.th]}>Description</Text>
            <Text style={[doc.cRate, doc.th]}>Rate</Text>
            <Text style={[doc.cQty, doc.th]}>Qty</Text>
            <Text style={[doc.cAmt, doc.th]}>Amount</Text>
          </View>
          {data.items.map((item, i) => {
            const lineTotal = item.price * item.quantity; // gross; item discount shown separately
            return (
              <View key={i} style={doc.tRow}>
                <View style={doc.cDesc}>
                  <Text>{item.name}</Text>
                  {item.staffName ? <Text style={doc.sub}>with {item.staffName}</Text> : null}
                  {item.discount > 0 ? <Text style={doc.sub}>Item discount -{money(item.discount)}</Text> : null}
                </View>
                <Text style={doc.cRate}>{money(item.price)}</Text>
                <Text style={doc.cQty}>{item.quantity}</Text>
                <Text style={doc.cAmt}>{money(lineTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={doc.totalsWrap}>
          <View style={doc.totals}>
            <DocRow label="Subtotal" value={money(data.subtotal)} />
            {data.discount > 0 ? <DocRow label={discountLabel(data)} value={`-${money(data.discount)}`} /> : null}
            {loyaltyValue > 0 ? <DocRow label="Loyalty (points)" value={`-${money(loyaltyValue)}`} /> : null}
            {data.tax > 0 ? <DocRow label="Tax" value={money(data.tax)} /> : null}
            <View style={doc.totalLine}>
              <Text style={doc.totalText}>Total</Text>
              <Text style={doc.totalText}>{money(data.total)}</Text>
            </View>
            {data.payments.map((p, i) => (
              <DocRow
                key={i}
                label={PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? String(p.method)}
                value={money(p.amount)}
              />
            ))}
            {data.payments.length > 0 ? <DocRow label="Total Paid" value={money(data.amountPaid)} /> : null}
            {amountRefunded > 0 ? <DocRow label="Refunded" value={`-${money(amountRefunded)}`} /> : null}
            {balanceDue > 0 ? (
              <View style={doc.row}>
                <Text style={doc.bold}>Balance Due</Text>
                <Text style={doc.bold}>{money(balanceDue)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={doc.status}>{`*** ${receiptStatusLabel(data)} ***`}</Text>
        {/* Loyalty — informational only, not part of the money totals above. */}
        {showLoyalty ? (
          <View style={{ marginTop: 6 }}>
            {pointsEarned > 0 ? <Text style={doc.thanks}>Points earned: +{pointsEarned}</Text> : null}
            {pointsBalance != null ? <Text style={doc.thanks}>Points balance: {pointsBalance}</Text> : null}
          </View>
        ) : null}
        <Text style={doc.thanks}>Thank you for your visit!</Text>
        {data.footerNote ? <Text style={doc.thanks}>{data.footerNote}</Text> : null}
      </Page>
    </Document>
  );
}

function DocRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View style={doc.row}>
      <Text style={doc.rowLabel}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}
