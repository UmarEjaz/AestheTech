import type { ReactElement } from "react";
import { DEFAULT_RECEIPT_SIZE, receiptFamily } from "@/lib/constants/receipt-sizes";
import { SlipReceipt } from "./slip-receipt";
import { DocumentReceipt } from "./document-receipt";
import type { ReceiptData } from "./receipt-model";

// The data shape and the pure helpers live in receipt-model.ts (no JSX, shared with the PDF and the
// geometry estimate); re-exported here so callers and tests have one import for the receipt.
export { paymentStatus, receiptStatusLabel, type ReceiptData } from "./receipt-model";

/**
 * A print-optimized customer receipt (proof of payment for a completed sale). Two looks, chosen by the
 * salon's Receipt-size setting: a narrow monospace **slip** for thermal rolls (80/58mm) and a wider
 * **document** with a bordered items table for A5/A4 regular paper. Presentational only — the same
 * markup is used for the first print at checkout and any later reprint from the sale.
 */
export function Receipt({ data }: { data: ReceiptData }): ReactElement {
  const size = data.size ?? DEFAULT_RECEIPT_SIZE;
  return receiptFamily(size) === "document" ? (
    <DocumentReceipt data={data} size={size} />
  ) : (
    <SlipReceipt data={data} size={size} />
  );
}
