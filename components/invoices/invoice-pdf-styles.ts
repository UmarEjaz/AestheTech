import { StyleSheet } from "@react-pdf/renderer";

/** react-pdf styles for the invoice PDF (kept apart from the component so each file stays readable). */
export const styles = StyleSheet.create({
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
  // Cancelled / refunded: grey, so a voided bill never wears the green "settled" badge.
  invoiceStatusNeutral: {
    backgroundColor: "#6b7280",
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
