"use client";

import { useState } from "react";
import { Download, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ReportData } from "@/lib/actions/dashboard";
import { downloadCSV, ExportColumn, formatCurrencyForExport } from "@/lib/export-utils";
import { downloadReportPDF } from "./report-pdf";
import { format } from "date-fns";

interface ExportButtonsProps {
  data: ReportData;
  startDate: Date;
  endDate: Date;
}

export function ExportButtons({ data, startDate, endDate }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      await downloadReportPDF(data, startDate, endDate);
      toast.success("PDF report downloaded successfully");
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast.error("Failed to export PDF report");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportRevenueCSV = () => {
    const columns: ExportColumn<typeof data.revenueByDay[0]>[] = [
      { header: "Date", accessor: (row) => format(new Date(row.date), "MMM d, yyyy") },
      { header: "Revenue", accessor: (row) => formatCurrencyForExport(row.revenue, data.currencySymbol) },
      { header: "Sales Count", accessor: "salesCount" },
    ];

    downloadCSV(data.revenueByDay, columns, `revenue-by-day-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Revenue data exported to CSV");
  };

  const handleExportServicesCSV = () => {
    const columns: ExportColumn<typeof data.revenueByService[0]>[] = [
      { header: "Service", accessor: "service" },
      { header: "Revenue", accessor: (row) => formatCurrencyForExport(row.revenue, data.currencySymbol) },
      { header: "Percentage", accessor: (row) => `${row.percentage}%` },
    ];

    downloadCSV(data.revenueByService, columns, `revenue-by-service-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Services data exported to CSV");
  };

  const handleExportStaffCSV = () => {
    const columns: ExportColumn<typeof data.revenueByStaff[0]>[] = [
      { header: "Staff Member", accessor: "staff" },
      { header: "Services Performed", accessor: "appointments" },
      { header: "Revenue", accessor: (row) => formatCurrencyForExport(row.revenue, data.currencySymbol) },
    ];

    downloadCSV(data.revenueByStaff, columns, `staff-performance-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Staff performance data exported to CSV");
  };

  const handleExportAppointmentsCSV = () => {
    const columns: ExportColumn<typeof data.appointmentsByStatus[0]>[] = [
      { header: "Status", accessor: (row) => row.status.replace("_", " ") },
      { header: "Count", accessor: "count" },
    ];

    downloadCSV(data.appointmentsByStatus, columns, `appointments-by-status-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Appointments data exported to CSV");
  };

  const handleExportPeakHoursCSV = () => {
    const columns: ExportColumn<typeof data.peakHours[0]>[] = [
      { header: "Hour", accessor: (row) => `${row.hour}:00 - ${row.hour + 1}:00` },
      { header: "Appointments", accessor: "count" },
    ];

    downloadCSV(data.peakHours, columns, `peak-hours-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Peak hours data exported to CSV");
  };

  const handleExportClientGrowthCSV = () => {
    const columns: ExportColumn<typeof data.clientGrowth[0]>[] = [
      { header: "Date", accessor: (row) => format(new Date(row.date), "MMM d, yyyy") },
      { header: "New Clients", accessor: "newClients" },
      { header: "Total Clients", accessor: "totalClients" },
    ];

    downloadCSV(data.clientGrowth, columns, `client-growth-${format(startDate, "yyyy-MM-dd")}`);
    toast.success("Client growth data exported to CSV");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleExportPDF} disabled={isExporting}>
          <FileText className="h-4 w-4 mr-2" />
          Full Report (PDF)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportRevenueCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Revenue by Day (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportServicesCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Revenue by Service (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportStaffCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Staff Performance (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportAppointmentsCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Appointments by Status (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPeakHoursCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Peak Hours (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportClientGrowthCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Client Growth (CSV)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
