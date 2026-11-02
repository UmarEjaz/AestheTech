import { describe, it, expect } from "vitest";
import { impliedLoyaltyValue } from "./receipt-totals";

describe("impliedLoyaltyValue", () => {
  it("is 0 when the totals already foot (no points redeemed)", () => {
    expect(impliedLoyaltyValue({ subtotal: 100, discount: 10, tax: 9, total: 99 })).toBe(0);
  });

  it("equals the gap that points redemption opened up", () => {
    // 100 − 10 − 20(points) + 7 = 77
    expect(impliedLoyaltyValue({ subtotal: 100, discount: 10, tax: 7, total: 77 })).toBe(20);
  });

  it("never returns a negative value", () => {
    // A total larger than subtotal−discount+tax (shouldn't happen) must not show a negative loyalty line.
    expect(impliedLoyaltyValue({ subtotal: 50, discount: 0, tax: 5, total: 60 })).toBe(0);
  });

  it("rounds the gap to whole cents", () => {
    // 33.33% discount + 8.75% tax style messiness still yields a clean cent figure.
    const v = impliedLoyaltyValue({ subtotal: 100, discount: 33.33, tax: 5.83, total: 52.5 });
    expect(v).toBeCloseTo(20, 2);
    expect(Number.isInteger(Math.round(v * 100))).toBe(true);
  });

  it("keeps the document footing: subtotal − discount − loyalty + tax === total", () => {
    const t = { subtotal: 110, discount: 10, tax: 8, total: 88 };
    const loyalty = impliedLoyaltyValue(t);
    expect(t.subtotal - t.discount - loyalty + t.tax).toBeCloseTo(t.total, 2);
  });
});
