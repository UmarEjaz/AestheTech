import { describe, it, expect } from "vitest";
import { estimateSlipHeight } from "./receipt-geometry";
import { baseReceipt as base } from "./receipt-test-data";

describe("estimateSlipHeight", () => {
  it("never goes below the 340pt floor", () => {
    expect(estimateSlipHeight({ ...base, items: [], payments: [] })).toBe(340);
  });

  it("grows with the number of items", () => {
    const few = estimateSlipHeight(base);
    const many = estimateSlipHeight({
      ...base,
      items: Array.from({ length: 20 }, (_, i) => ({
        name: `Item ${i}`,
        staffName: "Someone",
        quantity: 1,
        price: 5,
        discount: 1,
      })),
    });
    expect(many).toBeGreaterThan(few);
  });

  it("counts each typed line of the footer note, not just its length", () => {
    const oneLine = estimateSlipHeight({ ...base, footerNote: "No refunds. Thanks!" });
    const threeLines = estimateSlipHeight({ ...base, footerNote: "No refunds.\nThanks!\nSee you soon" });
    expect(threeLines - oneLine).toBe(20); // two extra printed lines at 10pt each
  });

  it("grows with the number of payments and a refund row", () => {
    const onePayment = estimateSlipHeight(base);
    const threePayments = estimateSlipHeight({
      ...base,
      payments: [
        { method: "CASH", amount: 3 },
        { method: "CARD", amount: 3 },
        { method: "CASH", amount: 4 },
      ],
    });
    expect(threePayments).toBeGreaterThan(onePayment);
    expect(estimateSlipHeight({ ...base, amountRefunded: 5 })).toBeGreaterThan(onePayment);
  });
});
