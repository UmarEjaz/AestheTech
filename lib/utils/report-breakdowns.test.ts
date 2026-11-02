import { describe, it, expect } from "vitest";
import { profitByClient, reportLine, revenueByItem, revenueByStaff, type LineSource } from "./report-breakdowns";

const cut: LineSource = { id: "i1", service: { id: "s1", name: "Haircut" }, product: null, staff: { id: "u1", firstName: "Emma", lastName: "Wilson" } };
const serum: LineSource = { id: "i2", service: null, product: { id: "p1", name: "Serum" }, staff: null };
const jen = { key: "c1", name: "Jennifer Smith" };

describe("report breakdowns", () => {
  const sold = [
    reportLine(cut, jen, "sale1", 60, 10),
    reportLine(serum, jen, "sale1", 40, 10),
    reportLine(cut, jen, "sale2", 60, 10),
  ];

  it("totals each service and product, with its share of revenue and its profit", () => {
    expect(revenueByItem(sold, true)).toEqual([
      { item: "Haircut", revenue: 120, percentage: 75, cost: 20, profit: 100, margin: 83.3 },
      { item: "Serum", revenue: 40, percentage: 25, cost: 10, profit: 30, margin: 75 },
    ]);
    expect(revenueByItem(sold, false)[0]).toEqual({ item: "Haircut", revenue: 120, percentage: 75 });
  });

  it("takes a refund or cancellation off the item, staff member and client it belongs to", () => {
    const refunded = [...sold, reportLine(cut, jen, null, -60, 0)];
    expect(revenueByItem(refunded, false)[0]).toMatchObject({ item: "Haircut", revenue: 60 });
    // The staff member's count of services is of what they did, not changed by the refund.
    expect(revenueByStaff(refunded, false)).toEqual([{ staff: "Emma Wilson", revenue: 60, appointments: 2 }]);
    expect(profitByClient(refunded)).toEqual([
      { client: "Jennifer Smith", revenue: 100, cost: 30, profit: 70, margin: 70, salesCount: 2 },
    ]);
  });

  it("leaves items with no staff member out of the staff breakdown", () => {
    expect(revenueByStaff([reportLine(serum, jen, "sale1", 40, 10)], true)).toEqual([]);
  });

  it("names an item with neither a service nor a product Unknown, keeping each one separate", () => {
    const mystery = (id: string): LineSource => ({ id, service: null, product: null, staff: null });
    const rows = revenueByItem([reportLine(mystery("a"), jen, "s", 5, 0), reportLine(mystery("b"), jen, "s", 5, 0)], false);
    expect(rows.map((r) => r.item)).toEqual(["Unknown", "Unknown"]);
  });
});
