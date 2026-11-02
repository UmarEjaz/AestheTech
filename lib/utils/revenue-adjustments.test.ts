import { describe, it, expect } from "vitest";
import {
  billAdjustments,
  costChange,
  itemChanges,
  revenueChange,
  sumOf,
  type AdjustableBill,
  type AdjustableItem,
} from "./revenue-adjustments";

const day = (d: number): Date => new Date(`2026-10-${String(d).padStart(2, "0")}T10:00:00Z`);

// A $100 bill (no tax): a $60 service and two $20 products that cost $5 each.
function bill(over: Partial<AdjustableBill<AdjustableItem>> = {}): AdjustableBill<AdjustableItem> {
  return {
    total: 100,
    revenue: 100,
    pointsValue: 0,
    paid: 100,
    cancelledAt: null,
    refunds: [],
    items: [
      { price: 60, quantity: 1, costAtSale: 10, productId: null },
      { price: 20, quantity: 2, costAtSale: 5, productId: "p1" },
    ],
    clientId: "c1",
    clientName: "Jennifer Smith",
    ...over,
  };
}

describe("billAdjustments", () => {
  it("has none for a bill that was never refunded or cancelled", () => {
    expect(billAdjustments(bill())).toEqual([]);
  });

  it("takes a part refund's share off on the day it was made, without touching cost", () => {
    const [a] = billAdjustments(bill({ refunds: [{ amount: 30, createdAt: day(5) }] }));
    expect(a).toMatchObject({ at: day(5), share: 0.3, restocked: false });
    expect(revenueChange(a)).toBe(-30);
    expect(costChange(a)).toBe(0);
  });

  it("on a full refund takes everything off and puts the products' cost back", () => {
    const adjustments = billAdjustments(bill({ refunds: [{ amount: 40, createdAt: day(5) }, { amount: 60, createdAt: day(9) }] }));
    expect(adjustments.map((a) => [a.at, a.share, a.restocked])).toEqual([
      [day(5), 0.4, false],
      [day(9), 0.6, true],
    ]);
    expect(sumOf(adjustments, revenueChange)).toBe(-100);
    expect(sumOf(adjustments, costChange)).toBe(-10); // only the products went back on the shelf
  });

  it("takes nothing off for change handed back on an overpaid deposit", () => {
    const changeOnly = bill({ paid: 110, refunds: [{ amount: 10, createdAt: day(1) }] });
    expect(billAdjustments(changeOnly)).toEqual([]);
    // A real refund after that comes off in full.
    const later = bill({ paid: 110, refunds: [{ amount: 10, createdAt: day(1) }, { amount: 25, createdAt: day(4) }] });
    expect(billAdjustments(later).map((a) => a.share)).toEqual([0.25]);
    // Refunding the whole $100 after the change is a full refund: the products' cost comes back.
    const full = bill({ paid: 110, refunds: [{ amount: 10, createdAt: day(1) }, { amount: 100, createdAt: day(4) }] });
    expect(billAdjustments(full).map((a) => [a.share, a.restocked])).toEqual([[1, true]]);
  });

  it("on a cancel where the salon kept $30, takes off only the $70 never paid", () => {
    const [a] = billAdjustments(bill({ paid: 30, cancelledAt: day(7) }));
    expect(a).toMatchObject({ at: day(7), share: 0.7, restocked: true });
    expect(revenueChange(a)).toBe(-70); // the $30 cancellation fee stays as income
    expect(costChange(a)).toBe(-10);
  });

  it("on a cancel with the $30 refunded, takes the whole bill off", () => {
    const adjustments = billAdjustments(bill({ paid: 30, cancelledAt: day(7), refunds: [{ amount: 30, createdAt: day(7) }] }));
    expect(sumOf(adjustments, revenueChange)).toBe(-100);
    expect(sumOf(adjustments, costChange)).toBe(-10); // stock came back once, at the cancel
  });

  it("measures refunds against the total, so tax comes off in proportion", () => {
    // $100 of services, 10% tax: total $110. A $55 refund takes half the revenue off.
    const [a] = billAdjustments(bill({ total: 110, paid: 110, refunds: [{ amount: 55, createdAt: day(3) }] }));
    expect(revenueChange(a)).toBe(-50);
  });

  // $100 of services, $20 of it paid with points, 10% tax on the rest: total $88.
  const withPoints = { revenue: 100, pointsValue: 20, total: 88 };

  it("on a full refund takes the whole bill off, the spent points going back too", () => {
    const [a] = billAdjustments(bill({ ...withPoints, paid: 88, refunds: [{ amount: 88, createdAt: day(3) }] }));
    expect(revenueChange(a)).toBe(-100);
  });

  it("on a part refund takes off only its share of the money; the points stay spent", () => {
    const [a] = billAdjustments(bill({ ...withPoints, paid: 88, refunds: [{ amount: 44, createdAt: day(3) }] }));
    expect(revenueChange(a)).toBe(-40);
  });

  it("on a cancel keeping the $44 paid, keeps that money and the spent points as income", () => {
    const [a] = billAdjustments(bill({ ...withPoints, paid: 44, cancelledAt: day(7) }));
    expect(revenueChange(a)).toBe(-40); // $40 never paid (before tax); $40 kept + $20 in points stays
  });

  it("on a cancel refunding the $44, takes the whole bill off, the points going back too", () => {
    const refunded = bill({ ...withPoints, paid: 44, cancelledAt: day(7), refunds: [{ amount: 44, createdAt: day(7) }] });
    expect(sumOf(billAdjustments(refunded), revenueChange)).toBe(-100);
  });

  it("never takes the points part off twice when a full refund came before the cancel", () => {
    const both = bill({ ...withPoints, paid: 88, cancelledAt: day(7), refunds: [{ amount: 88, createdAt: day(7) }] });
    expect(sumOf(billAdjustments(both), revenueChange)).toBe(-100);
  });

  it("on a cancel with nothing paid, takes the whole bill off, the points going back", () => {
    expect(sumOf(billAdjustments(bill({ ...withPoints, paid: 0, cancelledAt: day(7) })), revenueChange)).toBe(-100);
  });

  it("ignores a zero-total bill", () => {
    expect(billAdjustments(bill({ total: 0, paid: 0, cancelledAt: day(2) }))).toEqual([]);
  });
});

describe("itemChanges", () => {
  it("splits an adjustment across the items by price × quantity", () => {
    const [a] = billAdjustments(bill({ refunds: [{ amount: 50, createdAt: day(5) }] }));
    expect(itemChanges(a).map((c) => [c.revenue, c.cost])).toEqual([
      [-30, 0],
      [-20, 0],
    ]);
  });
});
