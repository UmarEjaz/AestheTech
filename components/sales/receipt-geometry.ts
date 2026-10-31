import { impliedLoyaltyValue, type ReceiptData } from "./receipt-model";

// Approx. characters an item name fits on one line before wrapping, by slip width (Courier 8pt, name
// column is the left ~70% of the printable width). Narrower rolls wrap sooner.
const NAME_CHARS_PER_LINE: Record<"THERMAL_80" | "THERMAL_58", number> = {
  THERMAL_80: 30,
  THERMAL_58: 20,
};

/**
 * Roughly size a thermal slip PDF to its content so the file isn't a long strip of whitespace (a
 * receipt is variable-length and react-pdf needs an explicit page height). A slight overestimate is
 * intentional — a little blank space is better than clipping. Each item allows for its name wrapping
 * across multiple lines (longer on the narrower 58mm roll), plus its staff and item-discount lines;
 * payments, the Refunded / Loyalty / Total Paid / Balance rows are counted too. Pure (no react-pdf
 * import) so it can be unit-tested.
 */
export function estimateSlipHeight(
  data: ReceiptData,
  size: "THERMAL_80" | "THERMAL_58" = "THERMAL_80"
): number {
  const perLine = NAME_CHARS_PER_LINE[size];
  let h = 290; // header + meta + subtotal/total block + status banner + thank-you line
  if (data.taxNumber) h += 12; // extra header line for the tax registration number
  if (data.footerNote) {
    // Footer note: each typed line prints on its own line (and may wrap further).
    const lines = data.footerNote.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    h += 10 + 10 * lines;
  }
  for (const it of data.items) {
    const nameLines = Math.max(1, Math.ceil(it.name.length / perLine));
    h += 12 * nameLines + 4 + (it.staffName ? 12 : 0) + (it.discount > 0 ? 12 : 0);
  }
  h += data.payments.length * 13; // one row per payment
  h += 26; // Total Paid + Balance Due
  if ((data.amountRefunded ?? 0) > 0) h += 13; // Refunded row
  if (impliedLoyaltyValue(data) > 0) h += 13; // Loyalty (points) row
  // Informational loyalty block (divider + earned/balance rows) at the foot.
  if ((data.pointsEarned ?? 0) > 0 || data.pointsBalance != null) {
    h += 8; // divider
    if ((data.pointsEarned ?? 0) > 0) h += 12;
    if (data.pointsBalance != null) h += 12;
  }
  return Math.max(340, h);
}
