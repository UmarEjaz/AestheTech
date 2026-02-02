"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { ReportData } from "@/lib/actions/dashboard";
import { format } from "date-fns";

// PDF Styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#8b5cf6",
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#8b5cf6",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: "#666",
  },
  dateRange: {
    fontSize: 10,
    color: "#888",
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#333",
    backgroundColor: "#f3f4f6",
    padding: 8,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  summaryCard: {
    width: "25%",
    padding: 10,
  },
  summaryLabel: {
    fontSize: 9,
    color: "#666",
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  table: {
    width: "100%",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#8b5cf6",
    color: "#fff",
    padding: 8,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    padding: 8,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    padding: 8,
    backgroundColor: "#f9fafb",
  },
  tableCell: {
    flex: 1,
  },
  tableCellRight: {
    flex: 1,
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#888",
    fontSize: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
});

interface ReportPDFProps {
  data: ReportData;
  startDate: Date;
  endDate: Date;
  salonName?: string;
}

// PDF Document Component
function ReportPDFDocument({ data, startDate, endDate, salonName = "AestheTech Salon" }: ReportPDFProps) {
  const formatCurrency = (value: number) => `${data.currencySymbol}${value.toFixed(2)}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{salonName}</Text>
          <Text style={styles.subtitle}>Business Performance Report</Text>
          <Text style={styles.dateRange}>
            {format(startDate, "MMMM d, yyyy")} - {format(endDate, "MMMM d, yyyy")}
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Revenue</Text>
            <Text style={styles.summaryValue}>{formatCurrency(data.totals.revenue)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Sales</Text>
            <Text style={styles.summaryValue}>{data.totals.sales}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Appointments</Text>
            <Text style={styles.summaryValue}>{data.totals.appointments}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>New Clients</Text>
            <Text style={styles.summaryValue}>{data.totals.newClients}</Text>
          </View>
        </View>

        {/* Revenue by Service */}
        {data.revenueByService.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Revenue by Service</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableCell}>Service</Text>
                <Text style={styles.tableCellRight}>Revenue</Text>
                <Text style={styles.tableCellRight}>Percentage</Text>
              </View>
              {data.revenueByService.map((item, index) => (
                <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <Text style={styles.tableCell}>{item.service}</Text>
                  <Text style={styles.tableCellRight}>{formatCurrency(item.revenue)}</Text>
                  <Text style={styles.tableCellRight}>{item.percentage}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Staff Performance */}
        {data.revenueByStaff.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Staff Performance</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableCell}>Staff Member</Text>
                <Text style={styles.tableCellRight}>Services</Text>
                <Text style={styles.tableCellRight}>Revenue</Text>
              </View>
              {data.revenueByStaff.map((item, index) => (
                <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <Text style={styles.tableCell}>{item.staff}</Text>
                  <Text style={styles.tableCellRight}>{item.appointments}</Text>
                  <Text style={styles.tableCellRight}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Appointments by Status */}
        {data.appointmentsByStatus.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Appointments by Status</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableCell}>Status</Text>
                <Text style={styles.tableCellRight}>Count</Text>
              </View>
              {data.appointmentsByStatus.map((item, index) => (
                <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <Text style={styles.tableCell}>{item.status.replaceAll("_", " ")}</Text>
                  <Text style={styles.tableCellRight}>{item.count}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Peak Hours */}
        {data.peakHours.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Peak Hours</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableCell}>Time Slot</Text>
                <Text style={styles.tableCellRight}>Appointments</Text>
              </View>
              {[...data.peakHours]
                .sort((a, b) => b.count - a.count)
                .slice(0, 10)
                .map((item, index) => (
                  <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                    <Text style={styles.tableCell}>{`${item.hour}:00 - ${item.hour + 1}:00`}</Text>
                    <Text style={styles.tableCellRight}>{item.count}</Text>
                  </View>
                ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Generated on {format(new Date(), "MMMM d, yyyy 'at' h:mm a")} | AestheTech Salon Management System
        </Text>
      </Page>
    </Document>
  );
}

// Function to generate and download PDF
export async function downloadReportPDF(
  data: ReportData,
  startDate: Date,
  endDate: Date,
  salonName?: string
): Promise<void> {
  const doc = <ReportPDFDocument data={data} startDate={startDate} endDate={endDate} salonName={salonName} />;
  const blob = await pdf(doc).toBlob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `report-${format(startDate, "yyyy-MM-dd")}-to-${format(endDate, "yyyy-MM-dd")}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export { ReportPDFDocument };
