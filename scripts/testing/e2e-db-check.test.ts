import { describe, it, expect, afterEach, vi } from "vitest";
import { assertE2eDatabaseSafe, checkE2eDatabase } from "./e2e-db-check.mjs";

// Keep the developer's real `.env` out of this test worker: the guard's dotenv load is a no-op here, so
// only the variables each test stubs are set.
vi.mock("dotenv", () => ({ config: vi.fn() }));

const at = (url: string, extra: Record<string, string> = {}): ReturnType<typeof checkE2eDatabase> =>
  checkE2eDatabase({ DATABASE_URL: url, ...extra });

describe("checkE2eDatabase", () => {
  it("allows a local database, including the no-host socket form", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(at(`postgresql://u:p@${host}:5432/aesthetech`).ok).toBe(true);
    }
    expect(at("postgresql:///aesthetech").ok).toBe(true);
  });

  it("blocks a production-looking host or database name, even with the remote opt-in", () => {
    expect(at("postgresql://u:p@db.prod.example.com/aesthetech").ok).toBe(false);
    expect(at("postgresql://u:p@db.prod.example.com/aesthetech", { E2E_ALLOW_NONLOCAL_DB: "1" }).ok).toBe(false);
    expect(at("postgresql://u:p@localhost/aesthetech_production").ok).toBe(false);
  });

  it("does not mistake words like 'product' for production", () => {
    expect(at("postgresql://u:p@localhost/products").ok).toBe(true);
  });

  it("blocks a remote database unless it is explicitly opted in", () => {
    expect(at("postgresql://u:p@db.example.com/aesthetech").ok).toBe(false);
    expect(at("postgresql://u:p@db.example.com/aesthetech", { E2E_ALLOW_NONLOCAL_DB: "1" }).ok).toBe(true);
  });

  it("blocks a missing or malformed DATABASE_URL", () => {
    expect(checkE2eDatabase({}).ok).toBe(false);
    expect(at("not a url").ok).toBe(false);
  });
});

describe("assertE2eDatabaseSafe", () => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it("throws with the E2E-aborted reason for an unsafe database, and passes for a local one", () => {
    vi.stubEnv("E2E_ALLOW_NONLOCAL_DB", "");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@db.example.com/aesthetech");
    expect(() => assertE2eDatabaseSafe()).toThrow(/^E2E aborted: DATABASE_URL points at a NON-LOCAL database/);
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/aesthetech");
    expect(assertE2eDatabaseSafe()).toMatch(/passed/);
  });
});
