// Standalone E2E database guard, run by `npm run test:e2e` before Playwright installs its browser.
// The rules live in ./e2e-db-check.mjs, which playwright.config.ts also runs, so starting Playwright
// any other way (`npx playwright test`, a single spec) is checked too.
import { assertE2eDatabaseSafe } from "./e2e-db-check.mjs";

try {
  console.log(`✓ ${assertE2eDatabaseSafe()}`);
} catch (error) {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
