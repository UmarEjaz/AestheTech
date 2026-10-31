// Single source of truth for the customer-receipt paper sizes a salon can choose (Settings →
// Receipt size). Both the on-screen/printed receipt (HTML) and the downloadable PDF read their
// dimensions from here so the two stay in lockstep.

export const RECEIPT_SIZES = ["THERMAL_80", "THERMAL_58", "A5", "A4"] as const;
export type ReceiptSize = (typeof RECEIPT_SIZES)[number];

export const DEFAULT_RECEIPT_SIZE: ReceiptSize = "THERMAL_80";

/** Human-friendly name shown in the Settings dropdown. */
export const RECEIPT_SIZE_LABELS: Record<ReceiptSize, string> = {
  THERMAL_80: "Thermal 80mm",
  THERMAL_58: "Thermal 58mm",
  A5: "A5 (half page)",
  A4: "A4 (full page)",
};

/** One-line hint under each option, in plain language for non-technical staff. */
export const RECEIPT_SIZE_HINTS: Record<ReceiptSize, string> = {
  THERMAL_80: "Standard till-roll receipt printer",
  THERMAL_58: "Narrow till-roll receipt printer",
  A5: "Half a normal sheet, on a regular printer",
  A4: "A full sheet, on a regular printer",
};

/**
 * Two layouts: a narrow "slip" for thermal rolls (centred, monospace, variable length) and a wider
 * "document" for A5/A4 regular paper (bordered items table, like a traditional printed receipt).
 */
export type ReceiptFamily = "slip" | "document";

export function receiptFamily(size: ReceiptSize): ReceiptFamily {
  return size === "A5" || size === "A4" ? "document" : "slip";
}

/** Narrows an arbitrary stored string to a valid ReceiptSize, falling back to the default. */
export function asReceiptSize(value: string | null | undefined): ReceiptSize {
  return RECEIPT_SIZES.includes(value as ReceiptSize) ? (value as ReceiptSize) : DEFAULT_RECEIPT_SIZE;
}

// --- Print (HTML) geometry -------------------------------------------------

/** CSS `@page { size: ... }` value injected while printing so the sheet matches the receipt. */
export const RECEIPT_PAGE_CSS: Record<ReceiptSize, string> = {
  THERMAL_80: "80mm auto",
  THERMAL_58: "58mm auto",
  A5: "A5",
  A4: "A4",
};

/** Page margin for the printed sheet. Thermal rolls want almost none; paper wants a readable margin. */
export const RECEIPT_PAGE_MARGIN: Record<ReceiptSize, string> = {
  THERMAL_80: "4mm",
  THERMAL_58: "3mm",
  A5: "10mm",
  A4: "14mm",
};

/** On-screen content width for the HTML receipt (kept just inside the page so margins have room). */
export const RECEIPT_CONTENT_WIDTH: Record<ReceiptSize, string> = {
  THERMAL_80: "72mm",
  THERMAL_58: "50mm",
  A5: "128mm",
  A4: "182mm",
};

// --- Download (react-pdf) geometry -----------------------------------------

const MM = 2.834645669; // 1mm in PDF points

/**
 * Thermal-slip PDF width in points. Slips use a fixed width with a content-estimated height so the PDF
 * isn't a long strip of whitespace; the A5/A4 documents don't use this (they pass the standard paper
 * size string to react-pdf and flow naturally), so only the two thermal sizes are defined here.
 */
export const RECEIPT_PDF_WIDTH_PT: Record<"THERMAL_80" | "THERMAL_58", number> = {
  THERMAL_80: 80 * MM, // 226.77pt
  THERMAL_58: 58 * MM, // 164.41pt
};

/** Standard paper-size string react-pdf understands, for the document family. */
export const RECEIPT_PDF_PAGE_SIZE: Record<"A5" | "A4", "A5" | "A4"> = {
  A5: "A5",
  A4: "A4",
};
