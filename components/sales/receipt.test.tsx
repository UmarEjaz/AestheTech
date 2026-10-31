// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Receipt, paymentStatus, receiptStatusLabel, type ReceiptData } from "./receipt";
import { baseReceipt as base } from "./receipt-test-data";

// The slip layout's content is covered in slip-receipt.test.tsx; this file covers the size dispatch
// (A5/A4 → document layout) and the pure status helpers.
describe("Receipt — A5/A4 document layout", () => {
  it("renders the A4 document layout with a bordered items table", () => {
    render(<Receipt data={{ ...base, size: "A4" }} />);
    // Document layout exposes a real table with column headers; the slip layout does not.
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Rate")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("Billed to")).toBeInTheDocument();
    // Same money + status logic as the slip.
    expect(screen.getByText(/\*\*\* PAID \*\*\*/)).toBeInTheDocument();
    expect(screen.getByText("Beard Trim")).toBeInTheDocument();
  });

  it("shows the points info on the A4 document layout too", () => {
    render(<Receipt data={{ ...base, size: "A4", pointsEarned: 47, pointsBalance: 320 }} />);
    expect(screen.getByText(/Points earned: \+47/)).toBeInTheDocument();
    expect(screen.getByText(/Points balance: 320/)).toBeInTheDocument();
  });

  it("joins phone and email on one line, and drops that line when the salon has neither", () => {
    const { container, rerender } = render(<Receipt data={{ ...base, size: "A5" }} />);
    expect(screen.getByText(/\+1 555 0100\s+·\s+hello@glow\.test/)).toBeInTheDocument();
    const bare = { salonPhone: null, salonEmail: null, salonAddress: null, salonLogo: null, taxNumber: null };
    rerender(<Receipt data={{ ...base, ...bare, size: "A5" }} />);
    // Only the salon name is left in the header block: no empty contact line.
    expect(container.querySelector(".receipt > div")?.children).toHaveLength(1);
  });

  it("uses the slip layout (no table) for the thermal sizes", () => {
    render(<Receipt data={{ ...base, size: "THERMAL_58" }} />);
    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
  });
});

describe("paymentStatus", () => {
  it("is PAID with no balance when nothing is owed (total 0)", () => {
    expect(paymentStatus(0, 0)).toEqual({ balanceDue: 0, label: "PAID" });
  });
  it("clamps overpayment to a zero balance and PAID", () => {
    expect(paymentStatus(20, 25)).toEqual({ balanceDue: 0, label: "PAID" });
  });
  it("absorbs sub-cent float drift (no phantom balance)", () => {
    expect(paymentStatus(25.35, 25.349999)).toEqual({ balanceDue: 0, label: "PAID" });
  });
  it("reports a remaining balance as PARTIALLY PAID", () => {
    expect(paymentStatus(20, 5)).toEqual({ balanceDue: 15, label: "PARTIALLY PAID" });
  });
  it("reports UNPAID with the full balance when nothing is paid", () => {
    expect(paymentStatus(20, 0)).toEqual({ balanceDue: 20, label: "UNPAID" });
  });
});

describe("receiptStatusLabel", () => {
  const paid: ReceiptData = { ...base, refunded: false };
  it("full refund wins over paid status", () => {
    expect(receiptStatusLabel({ ...paid, refunded: true })).toBe("REFUNDED");
  });
  it("partial refund reads PARTIALLY REFUNDED, not PAID", () => {
    expect(receiptStatusLabel({ ...paid, amountRefunded: 1 })).toBe("PARTIALLY REFUNDED");
  });
  it("falls back to the payment status when there is no refund", () => {
    expect(receiptStatusLabel(paid)).toBe("PAID");
    expect(receiptStatusLabel({ ...paid, payments: [], amountPaid: 0 })).toBe("UNPAID");
  });
});
