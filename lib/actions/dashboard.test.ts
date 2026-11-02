import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { billAdjustments } from "@/lib/utils/revenue-adjustments";
import type { ReportItem } from "@/lib/report-adjustments";
import { haircut } from "@/lib/report-test-data";

// ---- Fakes for the server action's dependencies (no real DB / auth / redis) ----
const mockLoadAdjustments = vi.fn();
const groupBy = vi.fn();
const saleFind = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({
  checkAuthBasic: vi.fn(async () => ({ userId: "u1", salonId: "salon_1", roleId: "r1", isSuperAdmin: false })),
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock("./settings", () => ({
  getSettings: vi.fn(async () => ({ success: true, data: { currencyCode: "USD", timezone: "UTC" } })),
}));
vi.mock("@/lib/redis", () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn() }));
vi.mock("./branch", () => ({ getOrganizationSalonIds: vi.fn(), getOrgRootSalonId: vi.fn() }));
vi.mock("./modules", () => ({ getDisabledModulesForSalon: vi.fn(async () => []) }));
vi.mock("@/lib/report-adjustments", () => ({ loadRevenueAdjustments: (...a: unknown[]) => mockLoadAdjustments(...a) }));
vi.mock("@/lib/prisma", () => {
  const empty = { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) };
  return {
    prisma: {
      appointment: { ...empty, groupBy: vi.fn(async () => []) },
      sale: { ...empty, findMany: (...a: unknown[]) => saleFind(...a) },
      client: empty,
      saleItem: { ...empty, groupBy: (...a: unknown[]) => groupBy(...a) },
      expense: empty,
      payrollEntry: { groupBy: vi.fn(async () => []) },
      payment: { aggregate: vi.fn(async () => ({ _sum: { amount: null } })) },
      service: { findMany: vi.fn(async () => [{ id: "s1", name: "Haircut" }]) },
      user: { findMany: vi.fn(async () => [{ id: "u1", firstName: "Emma", lastName: "Wilson" }]) },
    },
  };
});

import { getDashboardStats } from "./dashboard";

const refundedOn = (at: string): ReturnType<typeof billAdjustments<ReportItem>> =>
  billAdjustments({
    total: 100,
    revenue: 100,
    pointsValue: 0,
    paid: 100,
    cancelledAt: null,
    refunds: [{ amount: 40, createdAt: new Date(at) }],
    items: [haircut],
    clientId: "c1",
    clientName: "Jennifer Smith",
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Pinned so "today", "yesterday" and "this month" never depend on when the test runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  // This month, two haircuts by Emma for $200.
  groupBy.mockResolvedValue([{ serviceId: "s1", staffId: "u1", _count: { id: 2 }, _sum: { price: "200.00" } }]);
  saleFind.mockResolvedValue([]);
});

afterEach((): void => {
  vi.useRealTimers();
});

describe("getDashboardStats", () => {
  it("takes today's refund off today's revenue and off this month's service and staff figures", async () => {
    mockLoadAdjustments.mockResolvedValue(refundedOn("2026-10-15T09:00:00Z"));
    const res = await getDashboardStats();
    if (!res.success) throw new Error(res.error);
    expect(res.data.todaysRevenue?.amount).toBe(-40); // no sales today, one $40 refund
    expect(res.data.topServices).toEqual([{ name: "Haircut", count: 2, revenue: 160 }]);
    expect(res.data.staffPerformance?.[0]).toMatchObject({ staffName: "Emma Wilson", revenue: 160 });
    expect(mockLoadAdjustments).toHaveBeenCalledWith(["salon_1"], expect.objectContaining({ lt: expect.any(Date) }));
  });

  it("takes refunds off top services per unit, like the price totals it adjusts", async () => {
    // Two units of a $50 item; refunding $40 of the $100 bill takes $20 per unit off.
    const twoUnits = billAdjustments<ReportItem>({
      total: 100,
      revenue: 100,
      pointsValue: 0,
      paid: 100,
      cancelledAt: null,
      refunds: [{ amount: 40, createdAt: new Date("2026-10-15T09:00:00Z") }],
      items: [{ ...haircut, price: 50, quantity: 2 }],
      clientId: "c1",
      clientName: "Jennifer Smith",
    });
    mockLoadAdjustments.mockResolvedValue(twoUnits);
    groupBy.mockResolvedValue([{ serviceId: "s1", staffId: "u1", _count: { id: 1 }, _sum: { price: "50.00" } }]);
    const res = await getDashboardStats();
    if (!res.success) throw new Error(res.error);
    expect(res.data.topServices?.[0].revenue).toBe(30);
  });

  it("leaves today alone for a refund made yesterday, but counts it against yesterday", async () => {
    // Yesterday: a $100 sale and the $40 refund, so $60. Today: nothing yet.
    saleFind.mockImplementation(async (args: { where: { createdAt?: { gte: Date } } }) =>
      args.where.createdAt && args.where.createdAt.gte < new Date("2026-10-15T00:00:00Z") ? [{ finalAmount: "100.00" }] : []
    );
    mockLoadAdjustments.mockResolvedValue(refundedOn("2026-10-14T09:00:00Z"));
    const res = await getDashboardStats();
    if (!res.success) throw new Error(res.error);
    expect(res.data.todaysRevenue?.amount).toBe(0);
    expect(res.data.todaysRevenue?.comparison).toBe(-100); // $0 today against yesterday's $60
    expect(res.data.topServices?.[0].revenue).toBe(160); // still this month
  });
});
