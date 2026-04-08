"use client";

import { useState } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { ShiftType } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const SHIFT_COLORS: Record<ShiftType, string> = {
  OPENING: "#3b82f6",
  CLOSING: "#8b5cf6",
  REGULAR: "#22c55e",
  SPLIT: "#f97316",
};

interface Schedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  isAvailable: boolean;
}

interface StaffWithSchedules {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  schedules: Schedule[];
}

interface SchedulePDFProps {
  staffWithSchedules: StaffWithSchedules[];
  salonName?: string;
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

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
  dateText: {
    fontSize: 10,
    color: "#888",
    marginTop: 4,
  },
  staffSection: {
    marginBottom: 16,
  },
  staffHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    backgroundColor: "#f3f4f6",
    padding: 8,
    borderRadius: 4,
  },
  staffName: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#333",
  },
  staffRole: {
    fontSize: 10,
    color: "#666",
    marginLeft: 8,
  },
  table: {
    width: "100%",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#8b5cf6",
    padding: 6,
  },
  tableHeaderCell: {
    flex: 1,
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    padding: 6,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    padding: 6,
    backgroundColor: "#f9fafb",
  },
  tableCell: {
    flex: 1,
    fontSize: 9,
  },
  shiftBadge: {
    fontSize: 8,
    padding: "2 4",
    borderRadius: 2,
    color: "#ffffff",
  },
  noSchedule: {
    fontSize: 9,
    color: "#999",
    fontStyle: "italic",
    padding: 6,
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

function SchedulePDFDocument({ staffWithSchedules, salonName = "AestheTech Salon" }: SchedulePDFProps) {
  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{salonName}</Text>
          <Text style={styles.subtitle}>Staff Schedule Overview</Text>
          <Text style={styles.dateText}>Generated on {generatedDate}</Text>
        </View>

        {/* Staff Schedules */}
        {staffWithSchedules.map((staff) => (
          <View key={staff.id} style={styles.staffSection} wrap={false}>
            <View style={styles.staffHeader}>
              <Text style={styles.staffName}>
                {staff.firstName} {staff.lastName}
              </Text>
              <Text style={styles.staffRole}>
                ({staff.role.toLowerCase().replace("_", " ")})
              </Text>
            </View>

            {staff.schedules.length === 0 ? (
              <Text style={styles.noSchedule}>No schedule assigned</Text>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeaderCell}>Day</Text>
                  <Text style={styles.tableHeaderCell}>Start</Text>
                  <Text style={styles.tableHeaderCell}>End</Text>
                  <Text style={styles.tableHeaderCell}>Shift Type</Text>
                  <Text style={styles.tableHeaderCell}>Status</Text>
                </View>
                {DAY_NAMES.map((dayName, dayIndex) => {
                  const daySchedules = staff.schedules
                    .filter((s) => s.dayOfWeek === dayIndex)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  if (daySchedules.length === 0) {
                    return (
                      <View
                        key={dayIndex}
                        style={dayIndex % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                      >
                        <Text style={styles.tableCell}>{dayName}</Text>
                        <Text style={styles.tableCell}>-</Text>
                        <Text style={styles.tableCell}>-</Text>
                        <Text style={styles.tableCell}>-</Text>
                        <Text style={styles.tableCell}>No shift</Text>
                      </View>
                    );
                  }
                  return daySchedules.map((schedule, i) => (
                    <View
                      key={`${dayIndex}-${i}`}
                      style={dayIndex % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                    >
                      <Text style={styles.tableCell}>{i === 0 ? dayName : ""}</Text>
                      <Text style={styles.tableCell}>
                        {formatTime(schedule.startTime)}
                      </Text>
                      <Text style={styles.tableCell}>
                        {formatTime(schedule.endTime)}
                      </Text>
                      <Text style={styles.tableCell}>
                        {schedule.shiftType.charAt(0) +
                          schedule.shiftType.slice(1).toLowerCase()}
                      </Text>
                      <Text style={styles.tableCell}>
                        {schedule.isAvailable ? "Available" : "Day Off"}
                      </Text>
                    </View>
                  ));
                })}
              </View>
            )}
          </View>
        ))}

        {/* Footer */}
        <Text style={styles.footer}>
          {salonName} - Staff Schedule Report - Generated on {generatedDate}
        </Text>
      </Page>
    </Document>
  );
}

// Export button component
export function SchedulePDFExportButton({
  staffWithSchedules,
  salonName,
}: SchedulePDFProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await pdf(
        <SchedulePDFDocument
          staffWithSchedules={staffWithSchedules}
          salonName={salonName}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `schedule-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Delay revoke to avoid cancelling download in Safari/Firefox
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      toast.success("Schedule PDF exported");
    } catch (error) {
      console.error("Error generating schedule PDF:", error);
      toast.error("Failed to generate schedule PDF");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={isExporting}>
      {isExporting ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4 mr-2" />
      )}
      {isExporting ? "Exporting..." : "Export PDF"}
    </Button>
  );
}
