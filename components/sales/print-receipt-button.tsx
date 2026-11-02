"use client";

import { useState, type ReactElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { Receipt as ReceiptIcon, Printer, Download, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { safeFilename, clientFileLabel } from "@/lib/utils/filename";
import { Receipt, type ReceiptData } from "./receipt";
import { ReceiptPDF } from "./receipt-pdf";
import { PrintOverlay, usePrintOverlay } from "./receipt-print-overlay";

interface ReceiptButtonProps {
  data: ReceiptData;
  variant?: "default" | "outline" | "ghost";
}

/**
 * Customer-receipt output in one clean control: **Print** (opens the browser print dialog with only
 * the receipt on paper — see the `@media print` rule in globals.css; works with thermal + regular
 * printers) or **Download PDF** (the same receipt in the salon's chosen size: thermal 80/58mm, A5 or
 * A4). Used for the first print at checkout and any later reprint from the sale detail page.
 */
export function PrintReceiptButton({ data, variant = "outline" }: ReceiptButtonProps): ReactElement {
  const [downloading, setDownloading] = useState(false);

  // "<Client> - Receipt <Invoice#>" — used for both the Save-as-PDF default name (print) and the
  // downloaded file name, so staff get a meaningful name instead of the browser tab title.
  const fileBase = safeFilename(`${clientFileLabel(data.client)} - Receipt ${data.receiptNumber}`);
  const { printing, print } = usePrintOverlay(fileBase);

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await pdf(<ReceiptPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileBase}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Receipt downloaded");
    } catch (error) {
      console.error("Error generating receipt PDF:", error);
      toast.error("Failed to generate receipt PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} disabled={downloading}>
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ReceiptIcon className="mr-2 h-4 w-4" />
            )}
            Receipt
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={print}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PrintOverlay open={printing} size={data.size}>
        <Receipt data={data} />
      </PrintOverlay>
    </>
  );
}
