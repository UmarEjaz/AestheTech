// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Receipt, paymentStatus, receiptStatusLabel, type ReceiptData } from "./receipt";
import { balanceOwed, cancellationNote, cancelledSummary } from "./receipt-model";
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

  it("prints no points as earned on a cancelled bill (they were taken back)", () => {
    render(<Receipt data={{ ...base, size: "A4", pointsEarned: 47, pointsBalance: 320, cancelled: true }} />);
    expect(screen.queryByText(/Points earned/)).toBeNull();
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

describe("balanceOwed", () => {
  it("is the cent-rounded balance while the bill stands, and nothing once it is cancelled", () => {
    expect(balanceOwed(20, 5, false)).toBe(15);
    expect(balanceOwed(20, 5, true)).toBe(0);
    expect(balanceOwed(20, 0, true)).toBe(0);
  });
});

describe("cancellationNote", () => {
  const cancelled = { cancelled: true, currencyCode: "USD" };
  it("says what became of money paid on a cancelled bill", () => {
    expect(cancellationNote({ ...cancelled, amountPaid: 30, amountRefunded: 30 })).toBe("$30.00 refunded");
    expect(cancellationNote({ ...cancelled, amountPaid: 30 })).toBe("$30.00 kept as a cancellation fee");
    expect(cancellationNote({ ...cancelled, amountPaid: 30, amountRefunded: 10 })).toBe(
      "$10.00 refunded · $20.00 kept as a cancellation fee"
    );
  });
  it("is empty when the bill stands or nothing was paid", () => {
    expect(cancellationNote({ ...cancelled, cancelled: false, amountPaid: 30 })).toBeNull();
    expect(cancellationNote({ ...cancelled, amountPaid: 0 })).toBeNull();
  });
});

describe("Receipt — cancelled bill", () => {
  it("prints what became of the money under the CANCELLED banner, on every layout", () => {
    for (const size of ["THERMAL_80", "A4"] as const) {
      const { unmount } = render(
        <Receipt data={{ ...base, size, amountPaid: 30, amountRefunded: 30, cancelled: true }} />
      );
      expect(screen.getByText("$30.00 refunded")).toBeInTheDocument();
      unmount();
    }
  });

  it("prints CANCELLED and no Balance Due on every layout, even with nothing paid", () => {
    for (const size of ["THERMAL_80", "A4"] as const) {
      const { unmount } = render(<Receipt data={{ ...base, size, payments: [], amountPaid: 0, cancelled: true }} />);
      expect(screen.getByText(/\*\*\* CANCELLED \*\*\*/)).toBeInTheDocument();
      expect(screen.queryByText("Balance Due")).toBeNull();
      unmount();
    }
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
  it("a cancelled bill reads CANCELLED, never UNPAID or PARTIALLY PAID", () => {
    expect(receiptStatusLabel({ ...paid, payments: [], amountPaid: 0, cancelled: true })).toBe("CANCELLED");
    expect(receiptStatusLabel({ ...paid, amountPaid: 1, cancelled: true })).toBe("CANCELLED");
  });
  it("falls back to the payment status when there is no refund", () => {
    expect(receiptStatusLabel(paid)).toBe("PAID");
    expect(receiptStatusLabel({ ...paid, payments: [], amountPaid: 0 })).toBe("UNPAID");
  });
});

describe("cancelledSummary", () => {
  const usd = { currencyCode: "USD", cancelled: true };
  it("adds what became of the money after the lead sentence", () => {
    expect(cancelledSummary("This bill was cancelled.", { ...usd, amountPaid: 30, amountRefunded: 30 })).toBe(
      "This bill was cancelled. $30.00 refunded."
    );
    expect(cancelledSummary("This bill was cancelled.", { ...usd, amountPaid: 30 })).toBe(
      "This bill was cancelled. $30.00 kept as a cancellation fee."
    );
  });
  it("is just the lead when nothing was paid, and nothing at all while the bill stands", () => {
    expect(cancelledSummary("This bill was cancelled.", { ...usd, amountPaid: 0 })).toBe("This bill was cancelled.");
    expect(cancelledSummary("This bill was cancelled.", { ...usd, cancelled: false, amountPaid: 30 })).toBeNull();
  });
});
