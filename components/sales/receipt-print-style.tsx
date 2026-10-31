import type { ReactElement } from "react";
import {
  RECEIPT_PAGE_CSS,
  RECEIPT_PAGE_MARGIN,
  DEFAULT_RECEIPT_SIZE,
  type ReceiptSize,
} from "@/lib/constants/receipt-sizes";

/**
 * Sets the printed sheet size to match the chosen receipt size. `@page` can't be scoped to an element,
 * so this renders a global `<style>` — but it's only mounted (inside the print overlay) while a receipt
 * is actually printing, so it only ever governs a receipt print. globals.css sets no global @page.
 */
export function ReceiptPrintStyle({ size = DEFAULT_RECEIPT_SIZE }: { size?: ReceiptSize }): ReactElement {
  const css = `@media print { @page { size: ${RECEIPT_PAGE_CSS[size]}; margin: ${RECEIPT_PAGE_MARGIN[size]}; } }`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
