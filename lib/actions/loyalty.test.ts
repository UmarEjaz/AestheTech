import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- Fakes for the server action's dependencies (no real DB / auth) ----
const mockCheckAuth = vi.fn();
const mockExpire = vi.fn();
const mockLogAudit = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({ checkAuth: (...a: unknown[]) => mockCheckAuth(...a) }));
vi.mock("@/lib/loyalty-expiry", () => ({ expirePoints: (...a: unknown[]) => mockExpire(...a) }));
vi.mock("./audit", () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));

import { processExpiredPoints } from "./loyalty";

afterEach((): void => {
  vi.restoreAllMocks(); // undo the console.error silencing spy, even when a test fails early
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuth.mockResolvedValue({ userId: "u1", role: "OWNER", salonId: "salon_1" });
  mockExpire.mockResolvedValue({ clientsAffected: 2, totalPointsExpired: 30 });
});

describe("processExpiredPoints", () => {
  it("expires points at the signed-in manager's own salon only, and logs it against that salon", async () => {
    expect(await processExpiredPoints()).toEqual({ success: true, data: { clientsAffected: 2, totalPointsExpired: 30 } });
    expect(mockCheckAuth).toHaveBeenCalledWith("settings:manage");
    expect(mockExpire).toHaveBeenCalledWith("salon_1");
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "POINTS_EXPIRED", salonId: "salon_1" }));
  });

  it("logs nothing when no points expired, and hides database errors", async () => {
    mockExpire.mockResolvedValueOnce({ clientsAffected: 0, totalPointsExpired: 0 });
    await processExpiredPoints();
    expect(mockLogAudit).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockExpire.mockRejectedValueOnce(new Error("connection to db.internal refused"));
    expect(await processExpiredPoints()).toEqual({ success: false, error: "Failed to process expired points" });
  });

  it("refuses without the settings permission, and never runs for every salon", async () => {
    mockCheckAuth.mockResolvedValue(null);
    expect(await processExpiredPoints()).toEqual({ success: false, error: "Unauthorized" });
    expect(mockExpire).not.toHaveBeenCalled();
  });
});
