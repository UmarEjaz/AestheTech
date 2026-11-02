import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF, statusBadgeStyle, type InvoicePDFData } from "./invoice-pdf";
import { styles } from "./invoice-pdf-styles";
import { baseInvoicePdf as base } from "./invoice-pdf-test-data";

// Smoke renders: each variant exercises a different set of conditional rows and must produce a real PDF.
const cases: Array<{ name: string; data: InvoicePDFData }> = [
  { name: "paid, with points earned, tax number and footer note", data: base },
  { name: "partially paid (balance due row)", data: { ...base, status: "PARTIALLY_PAID", amountPaid: 30 } },
  { name: "overdue (derived status), nothing paid", data: { ...base, status: "OVERDUE", amountPaid: 0 } },
  { name: "cancelled with nothing paid", data: { ...base, status: "CANCELLED", amountPaid: 0 } },
  { name: "refunded in full (refund row)", data: { ...base, status: "REFUNDED", amountRefunded: 77 } },
  { name: "a walk-in with no contact details and no loyalty", data: { ...base, client: { firstName: "Walk-in", lastName: null, email: null, phone: null, isWalkIn: true }, loyaltyPointsEarned: 0, taxNumber: null, footerNote: null } },
];

describe("statusBadgeStyle", () => {
  it("is green only for PAID, amber while money is owed, grey for cancelled/refunded", () => {
    expect(statusBadgeStyle("PAID")).toBe(styles.invoiceStatus);
    for (const owed of ["PENDING", "PARTIALLY_PAID", "OVERDUE"]) {
      expect(statusBadgeStyle(owed)).toBe(styles.invoiceStatusPending);
    }
    expect(statusBadgeStyle("CANCELLED")).toBe(styles.invoiceStatusNeutral);
    expect(statusBadgeStyle("REFUNDED")).toBe(styles.invoiceStatusNeutral);
  });
});

describe("InvoicePDF renders a real PDF", () => {
  for (const { name, data } of cases) {
    it(`renders without throwing: ${name}`, async () => {
      const buf = await renderToBuffer(<InvoicePDF data={data} />);
      expect(buf.length).toBeGreaterThan(500); // a real PDF, not an empty/failed render
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-"); // PDF magic bytes
    });
  }
}, 30000);
