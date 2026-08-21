import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatInTz } from "@/lib/utils/timezone";

// ---- Fakes for the server-action's dependencies (no real DB / auth / redis) ----
const mockCheckAuth = vi.fn();
const mockGetSettings = vi.fn();
const mockServiceFindMany = vi.fn();
const mockAppointmentFindMany = vi.fn();
const mockUserSalonFindMany = vi.fn();

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
    userSalon: { findMany: (...a: unknown[]) => mockUserSalonFindMany(...a) },
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
// Two services run back-to-back for DIFFERENT providers: svc_1 (30 min, stf_1) then svc_2 (45 min, stf_2).
const twoServices = [
  { serviceId: "svc_1", staffId: "stf_1" },
  { serviceId: "svc_2", staffId: "stf_2" },
];

beforeEach(() => {
  // Freeze the clock so `at()` (which builds dates off "now") and the action's own now-checks are
  // deterministic regardless of when the suite runs.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
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
  mockServiceFindMany.mockResolvedValue([{ id: "svc_1", duration: 30, isActive: true }]);
  mockAppointmentFindMany.mockResolvedValue([]); // no existing bookings by default
  // Both fixture staff are valid active providers by default (verifyStaffProviders).
  mockUserSalonFindMany.mockResolvedValue([{ userId: "stf_1" }, { userId: "stf_2" }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("validateCustomTime", () => {
  it("returns Unauthorized when not authenticated", async () => {
    mockCheckAuth.mockResolvedValue(null);
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Unauthorized");
  });

  it("accepts a valid in-hours, conflict-free time", async () => {
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.ok).toBe(true);
  });

  it("rejects a time that has already passed and suggests the next free slot from now", async () => {
    // Frozen now = 2026-06-15T12:00:00Z (17:00 Karachi). Earlier the same day is in the past; the
    // next free slot is the current time rounded onto the grid (17:00).
    const res = await validateCustomTime({
      assignments: oneService,
      startTime: new Date("2026-06-15T06:00:00Z"), // 11:00 Karachi, before "now"
    });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("past");
    expect(res.data.suggestionHHMM).toBe("17:00");
    expect(res.data.suggestionLabel).toBe("5 PM");
  });

  it("rejects a time before opening and suggests the first open slot", async () => {
    const res = await validateCustomTime({ assignments: oneService, startTime: at(8) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("outside-hours");
    expect(res.data.suggestionLabel).toBe("9 AM");
    expect(res.data.openLabel).toBe("9:00 AM");
    expect(res.data.closeLabel).toBe("7:00 PM");
  });

  it("rejects a time whose end runs past closing", async () => {
    // 6:45 PM start + 30 min = 7:15 PM, past the 7 PM close.
    const res = await validateCustomTime({ assignments: oneService, startTime: at(18, 45) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("outside-hours");
    expect(res.data.openLabel).toBe("9:00 AM");
    expect(res.data.closeLabel).toBe("7:00 PM");
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

  it("rolls the suggestion to the next open day when the requested day is full", async () => {
    const start = at(10);
    // The whole requested day (09:00–19:00 = 10h) is blocked for our staff, so no same-day slot fits.
    mockAppointmentFindMany
      .mockResolvedValueOnce([{ startTime: at(9), services: [{ staffId: "stf_1", duration: 600 }] }]) // same-day query
      .mockResolvedValueOnce([]); // future-day query: later days are free
    const res = await validateCustomTime({ assignments: oneService, startTime: start });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("conflict");
    // Next free slot is the following day's opening time.
    expect(res.data.suggestionHHMM).toBe("09:00");
    const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const expectedISO = formatInTz(nextDay, "yyyy-MM-dd", TZ);
    expect(res.data.suggestionDateISO).toBe(expectedISO);
    // Since it's a different day, the label names the day (not a bare "9 AM").
    expect(res.data.suggestionLabel).not.toBe("9 AM");
  });

  it("keeps the suggestion on the requested day (no date name) when that day has room", async () => {
    const res = await validateCustomTime({ assignments: oneService, startTime: at(8) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    const sameDayISO = formatInTz(at(8), "yyyy-MM-dd", TZ);
    expect(res.data.suggestionDateISO).toBe(sameDayISO);
    expect(res.data.suggestionLabel).toBe("9 AM");
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

  it("excludes the edited appointment from its own conflict check", async () => {
    // Edit mode must pass excludeAppointmentId into the Prisma query so an appointment never
    // conflicts with itself. Assert the emitted `where` filters it out.
    await validateCustomTime({
      assignments: oneService,
      startTime: at(10),
      excludeAppointmentId: "apt_self",
    });
    expect(mockAppointmentFindMany.mock.calls[0][0].where.id).toEqual({ not: "apt_self" });
  });

  it("detects a conflict on a LATER segment of a multi-service booking", async () => {
    // Non-30 interval also exercises the interval clamp.
    mockGetSettings.mockResolvedValue({
      success: true,
      data: { businessHoursStart: "09:00", businessHoursEnd: "19:00", timezone: TZ, appointmentInterval: 15 },
    });
    mockServiceFindMany.mockResolvedValue([
      { id: "svc_1", duration: 30, isActive: true },
      { id: "svc_2", duration: 45, isActive: true },
    ]);
    // svc_1 (stf_1) runs 10:00–10:30, svc_2 (stf_2) runs 10:30–11:15. An existing stf_2 booking at
    // 10:45–11:15 overlaps ONLY the second segment — the first provider's slice is free.
    mockAppointmentFindMany.mockResolvedValue([
      { startTime: at(10, 45), services: [{ staffId: "stf_2", duration: 30 }] },
    ]);
    const res = await validateCustomTime({ assignments: twoServices, startTime: at(10) });
    if (!res.success) throw new Error(res.error);
    expect(res.data.ok).toBe(false);
    if (res.data.ok) return;
    expect(res.data.reason).toBe("conflict");
  });

  it("rejects a service that is switched off (inactive)", async () => {
    mockServiceFindMany.mockResolvedValue([{ id: "svc_1", duration: 30, isActive: false }]);
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("A selected service is not available");
  });

  it("rejects an unknown service", async () => {
    mockServiceFindMany.mockResolvedValue([]); // service id not found
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
    // resolveServices distinguishes missing ("not found") from switched-off ("not available").
    if (!res.success) expect(res.error).toBe("A selected service was not found");
  });

  it("rejects a staff member who is not a valid provider in this branch", async () => {
    mockUserSalonFindMany.mockResolvedValue([]); // no matching active provider
    const res = await validateCustomTime({ assignments: oneService, startTime: at(10) });
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error).toBe(
        "Staff member not found, inactive, or not a service provider in this branch"
      );
  });
});
