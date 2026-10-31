import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReceiptPDF } from "./receipt-pdf";
import { RECEIPT_SIZES } from "@/lib/constants/receipt-sizes";
import { baseReceipt as base } from "./receipt-test-data"; // salonLogo is null there: keeps images out of the smoke test

describe("ReceiptPDF renders a real PDF for every size", () => {
  for (const size of RECEIPT_SIZES) {
    it(`renders ${size} to a non-empty PDF buffer`, async () => {
      const buf = await renderToBuffer(<ReceiptPDF data={{ ...base, size }} />);
      expect(buf.length).toBeGreaterThan(500); // a real PDF, not an empty/failed render
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-"); // PDF magic bytes
    });
  }

  it("renders with no items (edge case) without throwing", async () => {
    const buf = await renderToBuffer(
      <ReceiptPDF
        data={{ ...base, items: [], subtotal: 0, discount: 0, tax: 0, total: 0, payments: [], amountPaid: 0, size: "A4" }}
      />
    );
    expect(buf.length).toBeGreaterThan(500);
  });
}, 30000);
