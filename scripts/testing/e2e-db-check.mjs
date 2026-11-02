// The E2E database safety rules, shared by playwright.config.ts (so EVERY way of starting Playwright —
// `npm run test:e2e`, `npx playwright test`, a single spec — is checked before the server is built or a
// test starts) and the standalone CLI `scripts/testing/guard-e2e-db.mjs`. The specs CREATE and DELETE
// data (appointments, walk-in clients and their sales), so they must never run against a production (or
// unknown remote) database. Safe-by-default: local DBs are allowed, anything with a production marker is
// hard-blocked, and any other remote DB requires a deliberate opt-in (E2E_ALLOW_NONLOCAL_DB=1) — e.g. a
// CI-provisioned test database. (No `import.meta` here: Playwright compiles this file when loading its
// config, and its loader rejects it.)
import { config } from "dotenv";

// Treat "prod"/"production" as a whole word or hyphen/underscore/dot-delimited segment (so "product"
// or "reproduce" don't false-positive).
const PROD_MARKER = /(^|[-_.])prod(uction)?([-_.]|$)/i;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", ""];

/**
 * Decide whether E2E may run against `env.DATABASE_URL`. Pure (no I/O) so it can be unit-tested.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, message: string }}
 */
export function checkE2eDatabase(env) {
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, message: "DATABASE_URL is not set. Point it at a local/test database first." };

  let host = "";
  let dbName = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    dbName = decodeURIComponent(u.pathname.replace(/^\//, "")).toLowerCase();
  } catch {
    return { ok: false, message: "DATABASE_URL is not a valid URL." };
  }

  if (PROD_MARKER.test(host) || PROD_MARKER.test(dbName)) {
    return {
      ok: false,
      message:
        `DATABASE_URL looks like PRODUCTION (host="${host}", db="${dbName}"). ` +
        "E2E creates/deletes data — never run it against production.",
    };
  }

  if (!LOCAL_HOSTS.includes(host) && env.E2E_ALLOW_NONLOCAL_DB !== "1") {
    return {
      ok: false,
      message:
        `DATABASE_URL points at a NON-LOCAL database (host="${host}"). E2E creates/deletes data. ` +
        "If this really is a disposable test database, re-run with E2E_ALLOW_NONLOCAL_DB=1.",
    };
  }

  return { ok: true, message: `E2E database check passed (host="${host || "local"}", db="${dbName}").` };
}

/**
 * Throw (stopping Playwright before anything runs) unless the database is safe for E2E. Loads `.env`
 * first, the same way the specs do; a real environment variable still wins.
 * @returns {string} the pass message
 */
export function assertE2eDatabaseSafe() {
  config({ quiet: true });
  const result = checkE2eDatabase(process.env);
  if (!result.ok) throw new Error(`E2E aborted: ${result.message}`);
  return result.message;
}
