"use client";

import type { ReactElement } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { safeFilename, clientFileLabel } from "@/lib/utils/filename";
import { PaymentReceipt, type PaymentReceiptData } from "./payment-receipt";
import { PrintOverlay, usePrintOverlay } from "./receipt-print-overlay";

/**
 * Prints a receipt for a SINGLE invoice payment (deposit / partial / pay-later). Compact icon button
 * meant to sit next to each payment row. Reuses the receipt print overlay + `@media print` rule.
 */
export function PaymentReceiptButton({ data }: { data: PaymentReceiptData }): ReactElement {
  const fileBase = safeFilename(`${clientFileLabel(data.client)} - Payment Receipt ${data.invoiceNumber}`);
  const { printing, print } = usePrintOverlay(fileBase);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title="Print payment receipt"
        aria-label="Print payment receipt"
        onClick={print}
      >
        <Printer className="h-3.5 w-3.5" />
      </Button>
      <PrintOverlay open={printing} size={data.size}>
        <PaymentReceipt data={data} />
      </PrintOverlay>
    </>
  );
}
