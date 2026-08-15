import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the real app (dev server on :3001) with a seeded database.
// Run locally with the dev server already up (`npm run dev`) + `npm run db:seed`, then `npm run test:e2e`.
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // One worker: these tests share a single dev server + database, so running them serially avoids
  // cross-test races (concurrent DB writes and a dev server compiling routes for two workers at once).
  workers: 1,
  // Retry once locally too: against `next dev`, the first hit to a route compiles on demand and an
  // occasional navigation aborts under load — a retry self-heals it (each test is idempotent: it
  // creates/cleans its own data). CI gets an extra retry for its colder start.
  retries: process.env.CI ? 2 : 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuse an already-running dev server locally; start one in CI. Either way it needs a seeded DB.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
