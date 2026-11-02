import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExpire = vi.fn();
vi.mock("@/lib/loyalty-expiry", () => ({ expirePoints: (...a: unknown[]) => mockExpire(...a) }));

import { GET } from "./route";

const call = (auth?: string): Promise<Response> =>
  GET(new Request("http://localhost/api/cron/expire-points", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-secret");
  mockExpire.mockResolvedValue({ clientsAffected: 1, totalPointsExpired: 10 });
});

afterEach((): void => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/expire-points", () => {
  it("expires points at every salon when called with the cron secret", async () => {
    const res = await call("Bearer test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Expired points processed", clientsAffected: 1, totalPointsExpired: 10 });
    expect(mockExpire).toHaveBeenCalledWith(null);
  });

  it("refuses a call without the right secret, or when no secret is set", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("reports a failure without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockExpire.mockRejectedValue(new Error("connection to db.internal refused"));
    const res = await call("Bearer test-secret");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to process expired points" });
  });
});
