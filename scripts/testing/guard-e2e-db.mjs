// Safety guard for `npm run test:e2e`. The E2E suite CREATES and DELETES appointment data, so it must
// never run against a production (or unknown remote) database. Safe-by-default: local DBs are allowed,
// anything with a production marker is hard-blocked, and any other remote DB requires a deliberate
// opt-in (E2E_ALLOW_NONLOCAL_DB=1) — e.g. a CI-provisioned test database. Fails BEFORE Playwright runs.
import { config } from "dotenv";

config(); // load DATABASE_URL from .env, same as the specs do

const fail = (msg) => {
  console.error(`\n✖ E2E aborted: ${msg}\n`);
  process.exit(1);
};

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set. Point it at a local/test database first.");

let host = "";
let dbName = "";
try {
  const u = new URL(url);
  host = u.hostname.toLowerCase();
  dbName = decodeURIComponent(u.pathname.replace(/^\//, "")).toLowerCase();
} catch {
  fail("DATABASE_URL is not a valid URL.");
}

const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(host);
// Treat "prod"/"production" as a whole word or hyphen/underscore/dot-delimited segment (so "product"
// or "reproduce" don't false-positive).
const prodMarker = /(^|[-_.])prod(uction)?([-_.]|$)/i;

if (prodMarker.test(host) || prodMarker.test(dbName)) {
  fail(
    `DATABASE_URL looks like PRODUCTION (host="${host}", db="${dbName}"). ` +
      "E2E creates/deletes data — never run it against production."
  );
}

if (!isLocal && process.env.E2E_ALLOW_NONLOCAL_DB !== "1") {
  fail(
    `DATABASE_URL points at a NON-LOCAL database (host="${host}"). E2E creates/deletes appointment ` +
      "data. If this really is a disposable test database, re-run with E2E_ALLOW_NONLOCAL_DB=1."
  );
}

console.log(`✓ E2E database check passed (host="${host || "local"}", db="${dbName}").`);
