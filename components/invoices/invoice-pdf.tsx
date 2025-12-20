"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import { format } from "date-fns";

// Define styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  salonLogo: {
    width: 60,
    height: 60,
    marginBottom: 8,
  },
  salonName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#7c3aed",
    marginBottom: 4,
  },
  salonContact: {
    fontSize: 9,
    color: "#6b7280",
    marginTop: 2,
  },
  invoiceTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#374151",
  },
  invoiceNumber: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  invoiceStatus: {
    fontSize: 10,
    color: "#ffffff",
    backgroundColor: "#22c55e",
    padding: "4 8",
    borderRadius: 4,
    marginTop: 8,
  },
  invoiceStatusPending: {
    backgroundColor: "#eab308",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#374151",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    color: "#6b7280",
  },
  value: {
    fontWeight: "bold",
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tableHeaderCell: {
    fontWeight: "bold",
    color: "#374151",
  },
  tableRow: {
    flexDirection: "row",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableCell: {
    color: "#4b5563",
  },
  colService: { flex: 2 },
  colStaff: { flex: 1.5 },
  colPrice: { flex: 1, textAlign: "right" },
  colQty: { flex: 0.5, textAlign: "center" },
  colTotal: { flex: 1, textAlign: "right" },
  totalsSection: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: "#e5e7eb",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 4,
  },
  totalLabel: {
    width: 100,
    textAlign: "right",
    marginRight: 20,
    color: "#6b7280",
  },
  totalValue: {
    width: 80,
    textAlign: "right",
  },
  grandTotal: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#374151",
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#7c3aed",
  },
  footer: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 9,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
  clientSection: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  paymentInfo: {
    marginTop: 20,
    padding: 12,
    backgroundColor: "#f0fdf4",
    borderRadius: 4,
  },
  loyaltyInfo: {
    marginTop: 10,
    padding: 8,
    backgroundColor: "#fef3c7",
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
  },
});

export interface InvoicePDFData {
  invoiceNumber: string;
  status: string;
  createdAt: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  salonLogo: string | null;
  currencySymbol: string;
  taxRate: number;
  client: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string;
  };
  items: Array<{
    id: string;
    service: { name: string };
    staff: { firstName: string; lastName: string };
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
}

interface InvoicePDFProps {
  data: InvoicePDFData;
}

export function InvoicePDF({ data }: InvoicePDFProps) {
  const formattedDate = format(new Date(data.createdAt), "MMMM d, yyyy");
  const formattedTime = format(new Date(data.createdAt), "h:mm a");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {data.salonLogo && (
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
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            <Text
              style={[
                styles.invoiceStatus,
                data.status === "PENDING" ? styles.invoiceStatusPending : {},
              ]}
            >
              {data.status}
            </Text>
          </View>
        </View>

        {/* Client Info */}
        <View style={styles.clientSection}>
          <Text style={styles.sectionTitle}>Bill To</Text>
          <Text style={styles.value}>
            {data.client.firstName} {data.client.lastName}
          </Text>
          <Text style={styles.label}>{data.client.phone}</Text>
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
          <Text style={styles.sectionTitle}>Services</Text>
          <View style={styles.table}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colService]}>
                Service
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
                <Text style={[styles.tableCell, styles.colService]}>
                  {item.service.name}
                </Text>
                <Text style={[styles.tableCell, styles.colStaff]}>
                  {item.staff.firstName} {item.staff.lastName}
                </Text>
                <Text style={[styles.tableCell, styles.colPrice]}>
                  {data.currencySymbol}
                  {item.price.toFixed(2)}
                </Text>
                <Text style={[styles.tableCell, styles.colQty]}>
                  {item.quantity}
                </Text>
                <Text style={[styles.tableCell, styles.colTotal]}>
                  {data.currencySymbol}
                  {(item.price * item.quantity).toFixed(2)}
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
              {data.currencySymbol}
              {data.subtotal.toFixed(2)}
            </Text>
          </View>

          {data.discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount:</Text>
              <Text style={[styles.totalValue, { color: "#22c55e" }]}>
                -{data.currencySymbol}
                {data.discount.toFixed(2)}
              </Text>
            </View>
          )}

          {data.tax > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({data.taxRate}%):</Text>
              <Text style={styles.totalValue}>
                {data.currencySymbol}
                {data.tax.toFixed(2)}
              </Text>
            </View>
          )}

          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={[styles.totalLabel, styles.grandTotalLabel]}>
              Total:
            </Text>
            <Text style={[styles.totalValue, styles.grandTotalValue]}>
              {data.currencySymbol}
              {data.total.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Loyalty Points */}
        {(data.loyaltyPointsEarned > 0 || data.loyaltyPointsRedeemed > 0) && (
          <View style={styles.loyaltyInfo}>
            <Text style={{ color: "#92400e", fontSize: 9 }}>
              {data.loyaltyPointsEarned > 0 &&
                `Points Earned: +${data.loyaltyPointsEarned}`}
              {data.loyaltyPointsEarned > 0 &&
                data.loyaltyPointsRedeemed > 0 &&
                " | "}
              {data.loyaltyPointsRedeemed > 0 &&
                `Points Redeemed: -${data.loyaltyPointsRedeemed}`}
            </Text>
          </View>
        )}

        {/* Payment Confirmation */}
        {data.status === "PAID" && (
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
          <Text style={{ marginTop: 4 }}>
            Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
