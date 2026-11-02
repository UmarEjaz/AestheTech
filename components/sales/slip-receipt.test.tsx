// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Receipt, type ReceiptData } from "./receipt";
import { baseReceipt as base } from "./receipt-test-data";

// The default (thermal slip) layout, rendered through <Receipt> exactly as the print overlay does.
describe("Receipt — thermal slip layout", () => {
  it("shows the salon header, receipt number, customer and salon-tz date", () => {
    render(<Receipt data={base} />);
    expect(screen.getByText("Glow Studio")).toBeInTheDocument();
    expect(screen.getByText("12 Market St")).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(screen.getByText("Jennifer Smith")).toBeInTheDocument();
    // 04:00Z printed in Asia/Karachi (UTC+5) is 9:00 AM.
    expect(screen.getByText(/Aug 17, 2026 9:00 AM/)).toBeInTheDocument();
  });

  it("renders each line with its total, quantity prefix, staff and item discount", () => {
    render(<Receipt data={base} />);
    expect(screen.getByText("Beard Trim")).toBeInTheDocument();
    expect(screen.getByText("with Emma Wilson")).toBeInTheDocument();
    expect(screen.getByText("2× Shampoo")).toBeInTheDocument(); // qty prefix
    expect(screen.getByText("Item discount")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument(); // beard trim line total
    expect(screen.getByText("$10.00")).toBeInTheDocument(); // Shampoo line is GROSS 2×$5; discount shown separately
  });

  it("shows totals and the payment method label", () => {
    render(<Receipt data={base} />);
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    // Labelled to show the per-line item discounts are folded into this one Discount line.
    expect(screen.getByText("Discount (incl. item discounts)")).toBeInTheDocument();
    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    // $25.35 shows 3× — the Total line, the Card payment line, and the Total Paid line.
    expect(screen.getAllByText("$25.35")).toHaveLength(3);
    expect(screen.getByText("Card")).toBeInTheDocument(); // PAYMENT_METHOD_LABELS.CARD
  });

  it("marks a fully-paid sale PAID with no balance due", () => {
    render(<Receipt data={base} />);
    expect(screen.getByText("Total Paid")).toBeInTheDocument();
    expect(screen.getByText(/\*\*\* PAID \*\*\*/)).toBeInTheDocument();
    expect(screen.queryByText("Balance Due")).toBeNull();
  });

  it("shows UNPAID + full balance due for a pending sale with no payment", () => {
    render(<Receipt data={{ ...base, payments: [], amountPaid: 0 }} />);
    expect(screen.getByText("Balance Due")).toBeInTheDocument();
    expect(screen.getByText(/\*\*\* UNPAID \*\*\*/)).toBeInTheDocument();
    // Balance equals the total.
    expect(screen.getAllByText("$25.35").length).toBeGreaterThanOrEqual(2);
  });

  it("shows PARTIALLY PAID + remaining balance for a partial payment", () => {
    render(<Receipt data={{ ...base, payments: [{ method: "CASH", amount: 10 }], amountPaid: 10 }} />);
    expect(screen.getByText(/\*\*\* PARTIALLY PAID \*\*\*/)).toBeInTheDocument();
    expect(screen.getByText("Balance Due")).toBeInTheDocument();
    expect(screen.getByText("$15.35")).toBeInTheDocument(); // 25.35 − 10
  });

  it("labels a walk-in customer and marks a refunded sale", () => {
    render(
      <Receipt
        data={{ ...base, client: { firstName: "", lastName: null, isWalkIn: true }, refunded: true }}
      />
    );
    expect(screen.getByText("Walk-in")).toBeInTheDocument();
    expect(screen.getByText(/Refunded/i)).toBeInTheDocument();
  });

  // Regression guard for the discount double-count bug: line totals must be GROSS so the customer can
  // add the lines up, and Subtotal − Discount + Tax must equal Total.
  it("shows gross line totals so the receipt reconciles with a per-line discount", () => {
    const footing: ReceiptData = {
      ...base,
      items: [{ name: "Facial", staffName: null, quantity: 2, price: 10, discount: 4 }], // gross 2×$10 = $20
      subtotal: 20,
      discount: 4, // the $4 line discount
      tax: 2,
      total: 18, // 20 − 4 + 2
      payments: [{ method: "CASH", amount: 18 }],
      amountPaid: 18,
    };
    render(<Receipt data={footing} />);
    // GROSS line total appears (also equals the Subtotal here, hence getAllByText); the NET line must not.
    expect(screen.getAllByText("$20.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$16.00")).toBeNull(); // the net line (20 − 4) must NOT appear
    expect(screen.getByText("Item discount")).toBeInTheDocument();
    // The receipt's own numbers foot.
    expect(footing.subtotal - footing.discount + footing.tax).toBeCloseTo(footing.total, 2);
  });

  it("marks a partially-refunded sale and shows the refunded amount (never a clean PAID)", () => {
    // Paid the full total, then $5 genuinely returned → net $20.35 < total → PARTIALLY REFUNDED.
    render(<Receipt data={{ ...base, amountRefunded: 5 }} />);
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("−$5.00")).toBeInTheDocument();
    expect(screen.getByText(/\*\*\* PARTIALLY REFUNDED \*\*\*/)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*\* PAID \*\*\*/)).toBeNull();
  });

  it("reads PAID (not PARTIALLY REFUNDED) when a refund only returns an overpaid deposit as change", () => {
    // Deposit of $30 on a $25.35 sale → $4.65 change refunded; net paid still equals the total.
    render(<Receipt data={{ ...base, amountPaid: 30, amountRefunded: 4.65 }} />);
    expect(screen.getByText(/\*\*\* PAID \*\*\*/)).toBeInTheDocument();
    expect(screen.queryByText(/PARTIALLY REFUNDED/)).toBeNull();
    expect(screen.getByText("Refunded")).toBeInTheDocument(); // change is still shown
    expect(screen.getByText("−$4.65")).toBeInTheDocument();
  });

  // Regression guard for the loyalty-redemption reconciliation bug: points redeemed at checkout reduce
  // the Total but not Subtotal/Discount, so the receipt must show a Loyalty line that closes the gap.
  it("shows a Loyalty (points) line so the receipt foots when points were redeemed", () => {
    const withPoints: ReceiptData = {
      ...base,
      items: [{ name: "Package", staffName: null, quantity: 1, price: 100, discount: 0 }],
      subtotal: 100,
      discount: 10,
      tax: 7,
      total: 77, // 100 − 10 − 20 (points) + 7 = 77
      payments: [{ method: "CARD", amount: 77 }],
      amountPaid: 77,
    };
    render(<Receipt data={withPoints} />);
    expect(screen.getByText("Loyalty (points)")).toBeInTheDocument();
    expect(screen.getByText("−$20.00")).toBeInTheDocument();
    // Subtotal − Discount − Loyalty + Tax === Total.
    expect(withPoints.subtotal - withPoints.discount - 20 + withPoints.tax).toBeCloseTo(withPoints.total, 2);
    expect(screen.getByText(/\*\*\* PAID \*\*\*/)).toBeInTheDocument();
  });

  it("shows no Loyalty line when no points were redeemed", () => {
    render(<Receipt data={base} />); // base foots exactly with no points
    expect(screen.queryByText("Loyalty (points)")).toBeNull();
  });

  it("shows informational points earned + balance when provided", () => {
    render(<Receipt data={{ ...base, pointsEarned: 47, pointsBalance: 320 }} />);
    expect(screen.getByText("Points earned")).toBeInTheDocument();
    expect(screen.getByText("+47")).toBeInTheDocument();
    expect(screen.getByText("Points balance")).toBeInTheDocument();
    expect(screen.getByText("320")).toBeInTheDocument();
  });

  it("omits the points info block when there's nothing to show", () => {
    render(<Receipt data={base} />);
    expect(screen.queryByText("Points earned")).toBeNull();
    expect(screen.queryByText("Points balance")).toBeNull();
  });

  it("prints the salon's tax registration number when set, and omits it when not", () => {
    const { rerender } = render(<Receipt data={{ ...base, taxNumber: "GB123456789" }} />);
    expect(screen.getByText(/Tax Reg\. No\. GB123456789/)).toBeInTheDocument();
    rerender(<Receipt data={base} />);
    expect(screen.queryByText(/Tax Reg\. No\./)).toBeNull();
  });

  it("prints the footer note when set, keeping the thank-you line, and omits it when not", () => {
    const { rerender } = render(
      <Receipt data={{ ...base, footerNote: "No refunds after 7 days." }} />
    );
    expect(screen.getByText("No refunds after 7 days.")).toBeInTheDocument();
    expect(screen.getByText("Thank you for your visit!")).toBeInTheDocument(); // kept, not replaced
    rerender(<Receipt data={base} />);
    expect(screen.queryByText("No refunds after 7 days.")).toBeNull();
  });

  // Guard: long item names must WRAP on the thermal slip, not truncate (the printed receipt is the
  // customer's copy — a clipped name loses information). jsdom can't measure overflow, so assert the
  // name uses the wrapping class and not `truncate`.
  it("wraps long item names on the slip instead of truncating them", () => {
    const longName = "Full Highlights, Toner & Olaplex Treatment";
    render(
      <Receipt
        data={{ ...base, items: [{ name: longName, staffName: null, quantity: 1, price: 30, discount: 0 }] }}
      />
    );
    const nameEl = screen.getByText(longName);
    expect(nameEl.className).not.toContain("truncate");
    expect(nameEl.className).toContain("break-words");
  });
});
