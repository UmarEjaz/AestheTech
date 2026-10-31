// No "use client": no browser-only APIs here, so this renders in the client download button (pdf())
// and server-side for the email attachment (renderToBuffer()).
import {
  Document,
  Page,
  Text,
  View,
  Image,
} from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import { impliedLoyaltyValue } from "@/lib/utils/receipt-totals";
import { formatInvoiceStatus } from "@/lib/utils/invoice-status";
import { paymentStatus } from "@/components/sales/receipt-model";
import { styles } from "./invoice-pdf-styles";

/** Statuses that still owe money — printed with the amber badge, never the green "settled" one. */
const OUTSTANDING_STATUSES = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];

/** Badge colour by status: green (the base style) only for PAID, amber while money is owed, grey for cancelled/refunded. */
export function statusBadgeStyle(
  status: string
): typeof styles.invoiceStatus | typeof styles.invoiceStatusPending | typeof styles.invoiceStatusNeutral {
  if (status === "PAID") return styles.invoiceStatus;
  return OUTSTANDING_STATUSES.includes(status) ? styles.invoiceStatusPending : styles.invoiceStatusNeutral;
}

export interface InvoicePDFData {
  invoiceNumber: string;
  status: string;
  createdAt: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  salonLogo: string | null;
  currencyCode: string;
  taxRate: number;
  timezone: string;
  client: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    isWalkIn?: boolean;
  };
  items: Array<{
    id: string;
    service: { name: string } | null;
    staff: { firstName: string; lastName: string } | null;
    product: { name: string } | null;
    price: number;
    quantity: number;
    discount: number;
    note: string | null;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number; // sum of payments — so the invoice shows Amount Paid / Balance Due, never a false "paid" look
  amountRefunded?: number; // money returned — so a refunded invoice doesn't print as cleanly settled
  taxNumber?: string | null; // business tax/VAT/GST registration number, shown under the salon header
  footerNote?: string | null; // optional terms/footer note printed in the invoice footer
  loyaltyPointsEarned: number;
}

interface InvoicePDFProps {
  data: InvoicePDFData;
}

/** Printable invoice document, rendered to PDF by @react-pdf/renderer. */
export function InvoicePDF({ data }: InvoicePDFProps): ReactElement {
  const formattedDate = formatInTz(data.createdAt, "MMMM d, yyyy", data.timezone);
  const formattedTime = formatInTz(data.createdAt, "h:mm a", data.timezone);

  // Loyalty points redeemed at checkout reduce the total (before tax) but aren't in Subtotal/Discount.
  // Show that value so the invoice foots: Subtotal − Discount − Loyalty + Tax = Total (0 if no points).
  const loyaltyValue = impliedLoyaltyValue(data);
  // Same cent-rounded balance the receipt prints, so the two documents never disagree.
  const { balanceDue } = paymentStatus(data.total, data.amountPaid);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {data.salonLogo && (
              // eslint-disable-next-line jsx-a11y/alt-text -- this is @react-pdf/renderer's <Image>, which renders into a PDF (not the DOM) and has no `alt` prop.
              <Image style={styles.salonLogo} src={data.salonLogo} />
            )}
            <Text style={styles.salonName}>{data.salonName}</Text>
            {data.salonAddress && (
              <Text style={styles.salonContact}>{data.salonAddress}</Text>
            )}
            {data.salonPhone && (
              <Text style={styles.salonContact}>Tel: {data.salonPhone}</Text>
            )}
            {data.salonEmail && (
              <Text style={styles.salonContact}>{data.salonEmail}</Text>
            )}
            {data.taxNumber && (
              <Text style={styles.salonContact}>Tax Reg. No. {data.taxNumber}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            <Text
              style={[
                styles.invoiceStatus,
                statusBadgeStyle(data.status),
              ]}
            >
              {formatInvoiceStatus(data.status).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Client Info */}
        <View style={styles.clientSection}>
          <Text style={styles.sectionTitle}>Bill To</Text>
          <Text style={styles.value}>
            {data.client.firstName}{data.client.lastName ? ` ${data.client.lastName}` : ""}{data.client.isWalkIn ? " (Walk-in)" : ""}
          </Text>
          {data.client.phone && (
            <Text style={styles.label}>{data.client.phone}</Text>
          )}
          {data.client.email && (
            <Text style={styles.label}>{data.client.email}</Text>
          )}
        </View>

        {/* Invoice Details */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Invoice Date:</Text>
            <Text style={styles.value}>{formattedDate}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Time:</Text>
            <Text style={styles.value}>{formattedTime}</Text>
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          <View style={styles.table}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colService]}>
                Item
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colStaff]}>
                Staff
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colPrice]}>
                Price
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
              <Text style={[styles.tableHeaderCell, styles.colTotal]}>
                Total
              </Text>
            </View>

            {/* Table Rows */}
            {data.items.map((item) => (
              <View key={item.id} style={styles.tableRow}>
                <View style={[styles.tableCell, styles.colService]}>
                  <Text>{item.service?.name || item.product?.name || "Unknown"}</Text>
                  {item.discount > 0 && (
                    <Text style={{ fontSize: 8, color: "#16a34a" }}>
                      -{formatCurrency(item.discount, data.currencyCode)} discount
                    </Text>
                  )}
                  {item.note ? <Text style={{ fontSize: 8, color: "#666" }}>Note: {item.note}</Text> : null}
                </View>
                <Text style={[styles.tableCell, styles.colStaff]}>
                  {item.staff
                    ? `${item.staff.firstName} ${item.staff.lastName}`.trim() || "-"
                    : "-"}
                </Text>
                <Text style={[styles.tableCell, styles.colPrice]}>
                  {formatCurrency(item.price, data.currencyCode)}
                </Text>
                <Text style={[styles.tableCell, styles.colQty]}>
                  {item.quantity}
                </Text>
                <Text style={[styles.tableCell, styles.colTotal]}>
                  {formatCurrency(item.price * item.quantity, data.currencyCode)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(data.subtotal, data.currencyCode)}
            </Text>
          </View>

          {data.discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount:</Text>
              <Text style={[styles.totalValue, { color: "#22c55e" }]}>
                -{formatCurrency(data.discount, data.currencyCode)}
              </Text>
            </View>
          )}

          {loyaltyValue > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Loyalty (points):</Text>
              <Text style={[styles.totalValue, { color: "#22c55e" }]}>
                -{formatCurrency(loyaltyValue, data.currencyCode)}
              </Text>
            </View>
          )}

          {data.tax > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({data.taxRate}%):</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(data.tax, data.currencyCode)}
              </Text>
            </View>
          )}

          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={[styles.totalLabel, styles.grandTotalLabel]}>
              Total:
            </Text>
            <Text style={[styles.totalValue, styles.grandTotalValue]}>
              {formatCurrency(data.total, data.currencyCode)}
            </Text>
          </View>

          {/* Amount paid + balance due so an unpaid/partial invoice never looks settled. */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Amount Paid:</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(data.amountPaid, data.currencyCode)}
            </Text>
          </View>
          {(data.amountRefunded ?? 0) > 0 && (
            // Surface refunds so a refunded invoice doesn't read as a clean settled bill.
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: "#b91c1c" }]}>Refunded:</Text>
              <Text style={[styles.totalValue, { color: "#b91c1c" }]}>
                -{formatCurrency(data.amountRefunded ?? 0, data.currencyCode)}
              </Text>
            </View>
          )}
          {balanceDue > 0 && (
            // Emphasized (bold red) but NOT a second bordered "grand total" row — the Total above is the
            // one grand-total; a matching border here would read as two competing totals.
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { fontWeight: "bold", color: "#b91c1c" }]}>
                Balance Due:
              </Text>
              <Text style={[styles.totalValue, { fontWeight: "bold", color: "#b91c1c" }]}>
                {formatCurrency(balanceDue, data.currencyCode)}
              </Text>
            </View>
          )}
        </View>

        {/* Loyalty Points */}
        {/* Points redeemed are shown in the totals as the "Loyalty (points)" line, so only earned here. */}
        {data.loyaltyPointsEarned > 0 && (
          <View style={styles.loyaltyInfo}>
            <Text style={{ color: "#92400e", fontSize: 9 }}>Points Earned: +{data.loyaltyPointsEarned}</Text>
          </View>
        )}

        {/* Payment Confirmation — suppressed when any refund exists, so a cheery "Payment Received"
            box never sits next to a Refunded row (a partial refund leaves status PAID). */}
        {data.status === "PAID" && (data.amountRefunded ?? 0) === 0 && (
          <View style={styles.paymentInfo}>
            <Text style={{ color: "#166534", fontWeight: "bold" }}>
              Payment Received
            </Text>
            <Text style={{ color: "#166534", fontSize: 9, marginTop: 2 }}>
              Thank you for your business!
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Thank you for choosing {data.salonName}!</Text>
          {data.footerNote && <Text style={{ marginTop: 4 }}>{data.footerNote}</Text>}
          <Text style={{ marginTop: 4 }}>
            Generated on {formatInTz(new Date(), "MMMM d, yyyy 'at' h:mm a", data.timezone)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
