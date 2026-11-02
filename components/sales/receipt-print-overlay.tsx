"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReceiptSize } from "@/lib/constants/receipt-sizes";
import { ReceiptPrintStyle } from "./receipt-print-style";

/** Body class set while a receipt is printing; `globals.css` scopes the print rules to it. */
export const PRINTING_CLASS = "receipt-printing";

/**
 * Drives the browser print dialog for a receipt overlay. While `printing` is true the caller renders
 * <PrintOverlay>; this hook swaps `document.title` to `fileBase` (the browser's "Save as PDF" default
 * name comes from it), marks <body> so the print CSS hides everything else, opens the dialog on the
 * next frame (so the overlay is painted first), and restores everything on `afterprint` — or after
 * 60s as a safety net, because some browsers / dismissed dialogs never fire `afterprint`.
 */
export function usePrintOverlay(fileBase: string): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const prevTitle = document.title;
    document.title = fileBase;
    document.body.classList.add(PRINTING_CLASS);
    const done = (): void => {
      document.title = prevTitle;
      document.body.classList.remove(PRINTING_CLASS);
      setPrinting(false);
    };
    window.addEventListener("afterprint", done);
    const fallback = window.setTimeout(done, 60000);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      window.removeEventListener("afterprint", done);
      window.clearTimeout(fallback);
      cancelAnimationFrame(raf);
      document.body.classList.remove(PRINTING_CLASS);
      document.title = prevTitle;
    };
  }, [printing, fileBase]);

  return { printing, print: (): void => setPrinting(true) };
}

/**
 * The receipt rendered into <body> for printing (only while `open`), with the per-size `@page` rule.
 * Hidden on screen and shown only on paper by the `.receipt-print-root` rules in globals.css.
 */
export function PrintOverlay({
  open,
  size,
  children,
}: {
  open: boolean;
  size: ReceiptSize | undefined;
  children: ReactNode;
}): ReactElement | null {
  if (!open) return null;
  return createPortal(
    <div className="receipt-print-root">
      <ReceiptPrintStyle size={size} />
      {children}
    </div>,
    document.body
  );
}
