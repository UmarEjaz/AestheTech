// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceiptPDF } from "./receipt-pdf";
import { RECEIPT_SIZES } from "@/lib/constants/receipt-sizes";
import { baseReceipt as base } from "./receipt-test-data";

// A real PDF can't be searched for text, so render the PDF's building blocks as plain HTML and check
// what the receipt says. (receipt-pdf.test.tsx proves the same component makes a real PDF.)
vi.mock("@react-pdf/renderer", async () => (await import("@/components/pdf-html-mock")).pdfHtmlMock);

describe("ReceiptPDF content — cancelled bill", () => {
  it("says CANCELLED and what became of the money, with no balance due, on every size", () => {
    for (const size of RECEIPT_SIZES) {
      const { unmount } = render(
        <ReceiptPDF data={{ ...base, size, payments: [{ method: "CASH", amount: 30 }], amountPaid: 30, cancelled: true }} />
      );
      expect(screen.getByText("*** CANCELLED ***")).toBeInTheDocument();
      expect(screen.getByText("$30.00 kept as a cancellation fee")).toBeInTheDocument();
      expect(screen.queryByText("Balance Due")).toBeNull();
      unmount();
    }
  });
});
