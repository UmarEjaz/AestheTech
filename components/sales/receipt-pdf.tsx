// No "use client": these react-pdf components use no browser-only APIs, so they render both in the
// client download buttons (via pdf()) and server-side for email attachments (via renderToBuffer()).
import type { ReactElement } from "react";
import { DEFAULT_RECEIPT_SIZE, receiptFamily } from "@/lib/constants/receipt-sizes";
import type { ReceiptData } from "./receipt-model";
import { SlipReceiptPDF, type SlipSize } from "./slip-receipt-pdf";
import { DocumentReceiptPDF, type DocumentSize } from "./document-receipt-pdf";

/** A print/download-ready customer receipt PDF. Thermal slip (80/58mm) or A5/A4 document — matches the
 *  salon's Receipt-size setting and the on-screen <Receipt>. */
export function ReceiptPDF({ data }: { data: ReceiptData }): ReactElement {
  const size = data.size ?? DEFAULT_RECEIPT_SIZE;
  return receiptFamily(size) === "document" ? (
    <DocumentReceiptPDF data={data} size={size as DocumentSize} />
  ) : (
    <SlipReceiptPDF data={data} size={size as SlipSize} />
  );
}
