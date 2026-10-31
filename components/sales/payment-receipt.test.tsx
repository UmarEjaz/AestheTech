// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentReceipt, type PaymentReceiptData } from "./payment-receipt";

const base: PaymentReceiptData = {
  invoiceNumber: "INV-000123",
  paymentDateISO: "2026-08-17T04:00:00Z", // 9:00 AM Asia/Karachi
  timezone: "Asia/Karachi",
  currencyCode: "USD",
  salonName: "Glow Studio",
  salonAddress: "12 Market St",
  salonPhone: "+1 555 0100",
  salonEmail: "hello@glow.test",
  client: { firstName: "Jennifer", lastName: "Smith" },
  method: "CARD",
  amount: 40,
  invoiceTotal: 100,
  totalPaid: 40,
};

describe("PaymentReceipt", () => {
  it("shows a partial payment with the remaining balance due", () => {
    render(<PaymentReceipt data={base} />);
    expect(screen.getByText("Payment Receipt")).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument(); // method label
    expect(screen.getByText("Amount Paid")).toBeInTheDocument();
    // $40.00 shows twice on a first partial payment — the "Amount Paid" line and "Total Paid".
    expect(screen.getAllByText("$40.00")).toHaveLength(2);
    expect(screen.getByText("Balance Due")).toBeInTheDocument();
    expect(screen.getByText("$60.00")).toBeInTheDocument(); // 100 − 40
    expect(screen.getByText(/Partial payment received/i)).toBeInTheDocument();
  });

  it("shows paid-in-full (zero balance) when totalPaid meets the invoice total", () => {
    render(<PaymentReceipt data={{ ...base, amount: 60, totalPaid: 100 }} />);
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/Paid in full/i)).toBeInTheDocument();
  });

  // Sub-cent float drift must not read as a partial payment with a $0.00 balance due.
  it("treats a sub-cent residual as paid in full, not partial", () => {
    render(<PaymentReceipt data={{ ...base, amount: 59.999999, totalPaid: 99.999999 }} />);
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/Paid in full/i)).toBeInTheDocument();
    expect(screen.queryByText("Balance Due")).toBeNull();
    expect(screen.queryByText(/Partial payment received/i)).toBeNull();
  });

  it("prints the tax number and footer note when set, on both the slip and the A4 sheet", () => {
    for (const size of ["THERMAL_80", "A4"] as const) {
      const { unmount } = render(
        <PaymentReceipt data={{ ...base, size, taxNumber: "GB123456789", footerNote: "No refunds after 7 days." }} />
      );
      expect(screen.getByText(/Tax Reg\. No\. GB123456789/)).toBeInTheDocument();
      expect(screen.getByText("No refunds after 7 days.")).toBeInTheDocument();
      unmount();
    }
  });

  it("leaves the tax number and footer out when not set", () => {
    render(<PaymentReceipt data={base} />);
    expect(screen.queryByText(/Tax Reg\. No\./)).toBeNull();
    expect(screen.queryByText("No refunds after 7 days.")).toBeNull();
  });
});
