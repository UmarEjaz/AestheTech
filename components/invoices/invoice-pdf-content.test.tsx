// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoicePDF } from "./invoice-pdf";
import { baseInvoicePdf as base } from "./invoice-pdf-test-data";

// A real PDF can't be searched for text, so render the PDF's building blocks as plain HTML and check
// which rows the invoice prints. (invoice-pdf.test.tsx proves the same component makes a real PDF.)
vi.mock("@react-pdf/renderer", async () => (await import("@/components/pdf-html-mock")).pdfHtmlMock);

describe("InvoicePDF content", () => {
  it("prints the Balance Due row while money is owed", () => {
    render(<InvoicePDF data={{ ...base, status: "PARTIALLY_PAID", amountPaid: 30 }} />);
    expect(screen.getByText(/Balance Due/)).toBeInTheDocument();
  });

  it("prints no Balance Due on a cancelled invoice, even with nothing paid", () => {
    render(<InvoicePDF data={{ ...base, status: "CANCELLED", amountPaid: 0 }} />);
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    expect(screen.queryByText(/Balance Due/)).toBeNull();
    expect(screen.getByText("Invoice Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Nothing was paid on this invoice.")).toBeInTheDocument();
  });

  it("says what became of the money on a cancelled invoice that was part-paid", () => {
    render(<InvoicePDF data={{ ...base, status: "CANCELLED", amountPaid: 30, amountRefunded: 30 }} />);
    expect(screen.getByText("$30.00 refunded.")).toBeInTheDocument();
    expect(screen.queryByText(/Balance Due/)).toBeNull();
  });
});
