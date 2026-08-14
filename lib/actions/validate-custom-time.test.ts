import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Fakes for the server-action's dependencies (no real DB / auth / redis) ----
const mockCheckAuth = vi.fn();
const mockGetSettings = vi.fn();
const mockServiceFindMany = vi.fn();
const mockAppointmentFindMany = vi.fn();

vi.mock("@/lib/auth-helpers", () => ({ checkAuth: (...a: unknown[]) => mockCheckAuth(...a) }));
vi.mock("@/lib/permissions", () => ({ hasPermission: vi.fn() }));
vi.mock("./settings", () => ({ getSettings: (...a: unknown[]) => mockGetSettings(...a) }));
vi.mock("./branch", () => ({ getOrganizationSalonIds: vi.fn(async () => ["salon_1"]) }));
vi.mock("./audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/redis", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db-retry", () => ({ runSerializable: vi.fn() }));
vi.mock("@/lib/payment-guards", () => ({ assertPaymentOwner: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    service: { findMany: (...a: unknown[]) => mockServiceFindMany(...a) },
    appointment: { findMany: (...a: unknown[]) => mockAppointmentFindMany(...a) },
  },
}));

import { validateCustomTime } from "./appointment";

// Karachi is UTC+5 with no DST — 09:00 local = 04:00 UTC.
const TZ = "Asia/Karachi";
// A future date (so "past" checks don't interfere) at a chosen local hour.
const at = (localHour: number, localMin = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  // localHour Karachi = (localHour - 5) UTC
  d.setUTCHours(localHour - 5, localMin, 0, 0);
  return d;
};

const oneService = [{ serviceId: "svc_1", staffId: "stf_1" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuth.mockResolvedValue({ salonId: "salon_1", userId: "u1" });
  mockGetSettings.mockResolvedValue({
    success: true,
    data: {
      businessHoursStart: "09:00",
      businessHoursEnd: "19:00",
      timezone: TZ,
      appointmentInterval: 30,
    },
  });
  mockServiceFindMany.mockResolvedValue([{ id: "svc_1", duration: 30 }]);
  mockAppointmentFindMany.mockResolvedValue([]); // no existing bookings by default
});

describe("validateCustomTime", () => {
  it("returns Unauthorized when not authenticated", async () => {
    mockCheckAuth.mockResolvedValue(null);
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
  });

  it("accepts a valid in-hours, conflict-free time", async () => {
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.ok).toBe(true);
  });

  it("rejects a time before opening and suggests the first open slot", async () => {
    const res = await validateCustomTime({ assignments: oneService, startTime: at(8) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("outside-hours");
    expect(res.data.suggestionLabel).toBe("9 AM");
  });

  it("rejects a time whose end runs past closing", async () => {
    // 6:45 PM start + 30 min = 7:15 PM, past the 7 PM close.
    const res = await validateCustomTime({ assignments: oneService, startTime: at(18, 45) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("outside-hours");
  });

  it("rejects a time that overlaps an existing booking and suggests the next free slot", async () => {
    // Existing 10:00–10:30 booking for the same staff.
    mockAppointmentFindMany.mockResolvedValue([
      {
        startTime: at(10),
        services: [{ staffId: "stf_1", duration: 30 }],
      },
    ]);
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("conflict");
    // 10:00 is taken, so the next 30-min slot is 10:30.
    expect(res.data.suggestionLabel).toBe("10:30 AM");
  });

  it("does not clash with a booking for a DIFFERENT staff member", async () => {
    mockAppointmentFindMany.mockResolvedValue([
      { startTime: at(10), services: [{ staffId: "someone_else", duration: 30 }] },
    ]);
    // findMany is filtered by staff in real life; here it returns an unrelated staff row, and the
    // segment overlap check must ignore it.
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(true);
  });

  it("rejects an unknown service", async () => {
    mockServiceFindMany.mockResolvedValue([]); // service id not found
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
  });
});
