import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const refundFind = vi.fn();
const invoiceFind = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { refund: { findMany: (...a: unknown[]) => refundFind(...a) }, invoice: { findMany: (...a: unknown[]) => invoiceFind(...a) } },
}));

import { loadRevenueAdjustments } from "./report-adjustments";
import { revenueChange } from "@/lib/utils/revenue-adjustments";

const at = (d: number, hour = 10): Date => new Date(`2026-10-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);

// A $100 bill paid in full, then refunded $30 on the 5th and $70 on the 20th. Amounts arrive as strings,
// the way Prisma Decimals do.
const refundedBill = {
  amount: "100.00",
  total: "100.00",
  cancelledAt: null,
  payments: [{ amount: "100.00" }],
  refunds: [
    { amount: "30.00", createdAt: at(5) },
    { amount: "70.00", createdAt: at(20) },
  ],
  sale: {
    finalAmount: "100.00",
    clientId: "c1",
    client: { firstName: "Jennifer", lastName: null },
    items: [
      {
        id: "i1",
        price: "100.00",
        quantity: 1,
        costAtSale: null,
        serviceId: "s1",
        productId: null,
        staffId: "u1",
        service: { id: "s1", name: "Haircut" },
        product: null,
        staff: { id: "u1", firstName: "Emma", lastName: "Wilson" },
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  refundFind.mockResolvedValue([{ invoiceId: "inv1" }]);
  invoiceFind.mockImplementation(async (args: { where: { id?: unknown } }) => (args.where.id ? [refundedBill] : []));
});

describe("loadRevenueAdjustments", () => {
  it("returns only the refunds and cancellations inside the range, for these salons", async () => {
    const range = { gte: at(1, 0), lte: at(10, 0) };
    const adjustments = await loadRevenueAdjustments(["salon_1"], range);
    expect(adjustments.map((a) => [a.at, a.share])).toEqual([[at(5), 0.3]]); // the 20th is outside
    expect(adjustments[0].bill).toMatchObject({ total: 100, revenue: 100, paid: 100, clientName: "Jennifer" });
    expect(refundFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: { in: ["salon_1"] }, createdAt: range } })
    );
    expect(invoiceFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: { in: ["salon_1"] }, status: "CANCELLED", cancelledAt: range } })
    );
  });

  it("works out what the client paid with points from the sale and invoice amounts", async () => {
    // $100 sale, $20 of it in points: invoice amount $80, total $88 with tax. A full refund of the $88.
    invoiceFind.mockImplementation(async (args: { where: { id?: unknown } }) =>
      args.where.id
        ? [{ ...refundedBill, amount: "80.00", total: "88.00", payments: [{ amount: "88.00" }], refunds: [{ amount: "88.00", createdAt: at(5) }] }]
        : []
    );
    const [a] = await loadRevenueAdjustments(["salon_1"], { gte: at(1, 0), lte: at(10, 0) });
    expect(a.bill.pointsValue).toBe(20);
    expect(revenueChange(a)).toBe(-100); // a full refund gives the spent points back too
  });

  it("treats an `lt` range end as exclusive", async () => {
    expect(await loadRevenueAdjustments(["salon_1"], { gte: at(1, 0), lt: at(5) })).toEqual([]);
    expect(await loadRevenueAdjustments(["salon_1"], { gte: at(1, 0), lte: at(5) })).toHaveLength(1);
  });

  it("loads each bill once, even with a refund and a cancel both in range", async () => {
    invoiceFind.mockImplementation(async (args: { where: { id?: unknown } }) => (args.where.id ? [refundedBill] : [{ id: "inv1" }]));
    await loadRevenueAdjustments(["salon_1"], { gte: at(1, 0), lte: at(31, 0) });
    expect(invoiceFind).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: { in: ["inv1"] }, salonId: { in: ["salon_1"] } } }));
  });

  it("skips loading bills when nothing was refunded or cancelled", async () => {
    refundFind.mockResolvedValue([]);
    expect(await loadRevenueAdjustments(["salon_1"], { gte: at(1, 0), lte: at(31, 0) })).toEqual([]);
    expect(invoiceFind).toHaveBeenCalledTimes(1); // only the cancelled-bills lookup
  });
});
