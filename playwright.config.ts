import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a PRODUCTION build of the app on :3001 with a seeded database.
// A production build (`next build && next start`) serves every route pre-compiled, so navigations
// never stall on `next dev`'s on-demand compilation — the suite runs fast and reliably.
// Run: `npm run db:seed`, then `npm run test:e2e` (it builds + starts the server automatically).
// Faster local iteration: keep your own server up on :3001 (`npm run build && npm run start -- -p 3001`,
// or even `npm run dev`) and it's reused instead of rebuilding each run.
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // One worker: these tests share a single server + database, so running them serially avoids
  // cross-test races (concurrent writes to the same appointment data).
  workers: 1,
  // One retry as insurance: each test is idempotent (creates + cleans its own data), so a rare
  // transient hiccup (network blip, cold cache) self-heals instead of failing the run.
  retries: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Build once, then serve the production bundle — pre-compiled routes make the suite fast + stable
  // (no `next dev` on-demand compilation stalling navigations). Reuse an already-running server on
  // :3001 locally to skip the rebuild; CI always builds fresh. Either way it needs a seeded DB.
  // Timeout covers a cold `next build` (compile + type-check) plus server start.
  webServer: {
    command: "npm run build && npx next start -p 3001",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // In production mode Auth.js won't trust the request host unless told to. Trust localhost for
    // the test server so login works (the app's trustHost honors this env — see lib/auth.ts).
    env: { AUTH_TRUST_HOST: "true" },
  },
});
