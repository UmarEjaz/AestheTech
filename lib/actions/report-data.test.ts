import { describe, it, expect, vi, beforeEach } from "vitest";
import { billAdjustments } from "@/lib/utils/revenue-adjustments";
import { haircut } from "@/lib/report-test-data";

// ---- Fakes for the server action's dependencies (no real DB / auth / redis) ----
const mockLoadAdjustments = vi.fn();
const saleFind = vi.fn();
const saleItemFind = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({
  checkAuthBasic: vi.fn(async () => ({ userId: "u1", salonId: "salon_1", roleId: "r1", isSuperAdmin: false })),
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock("./settings", () => ({
  getSettings: vi.fn(async () => ({ success: true, data: { currencyCode: "USD", timezone: "UTC" } })),
}));
vi.mock("@/lib/redis", () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn() }));
vi.mock("./branch", () => ({ getOrganizationSalonIds: vi.fn(), getOrgRootSalonId: vi.fn() }));
vi.mock("./modules", () => ({ isModuleEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/report-adjustments", () => ({ loadRevenueAdjustments: (...a: unknown[]) => mockLoadAdjustments(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { findMany: (...a: unknown[]) => saleFind(...a), count: vi.fn(async () => 0) },
    saleItem: { findMany: (...a: unknown[]) => saleItemFind(...a) },
    appointment: { findMany: vi.fn(async () => []) },
    client: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    expense: { findMany: vi.fn(async () => []) },
  },
}));

import { getReportData } from "./report-data";

beforeEach(() => {
  vi.clearAllMocks();
  // A $100 haircut sold on the 2nd, paid $30, cancelled on the 7th with the $30 kept.
  saleFind.mockResolvedValue([{ createdAt: new Date("2026-10-02T10:00:00Z"), finalAmount: "100.00" }]);
  saleItemFind.mockResolvedValue([
    { ...haircut, saleId: "sale1", price: "100.00", sale: { createdAt: new Date("2026-10-02T10:00:00Z"), clientId: "c1", client: { firstName: "Jennifer", lastName: "Smith" } } },
  ]);
  mockLoadAdjustments.mockResolvedValue(
    billAdjustments({
      total: 100,
      revenue: 100,
      pointsValue: 0,
      paid: 30,
      cancelledAt: new Date("2026-10-07T10:00:00Z"),
      refunds: [],
      items: [haircut],
      clientId: "c1",
      clientName: "Jennifer Smith",
    })
  );
});

describe("getReportData", () => {
  const range = { startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T23:59:59Z") };

  it("keeps a sale on its own day and takes a cancellation off on the day it happened", async () => {
    const res = await getReportData(range);
    if (!res.success) throw new Error(res.error);
    expect(res.data.revenueByDay?.map((d) => [d.date, d.revenue, d.salesCount])).toEqual([
      ["2026-10-02", 100, 1],
      ["2026-10-07", -70, 0],
    ]);
    // The $30 kept as a cancellation fee is what the salon earned.
    expect(res.data.totals.revenue).toBe(30);
    expect(res.data.revenueByItem?.[0]).toMatchObject({ item: "Haircut", revenue: 30 });
    expect(res.data.revenueByStaff?.[0]).toMatchObject({ staff: "Emma Wilson", revenue: 30, appointments: 1 });
    expect(res.data.profitByClient?.[0]).toMatchObject({ client: "Jennifer Smith", revenue: 30, salesCount: 1 });
    expect(mockLoadAdjustments).toHaveBeenCalledWith(["salon_1"], { gte: range.startDate, lte: range.endDate });
  });
});
