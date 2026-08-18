import { expect, type Page, type Locator } from "@playwright/test";

// Escape a free-text string (e.g. a client name) for safe use inside a `new RegExp(...)` locator, so
// characters like ( ) . + break neither the pattern nor the match.
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// First interaction with a heavy, just-loaded client page: a click BEFORE React hydration is silently
// dropped (the handler isn't attached yet), so a single click — or a fixed sleep-then-click — is
// unreliable. This re-clicks the trigger until `settled` passes, i.e. until the click visibly took
// effect. Use it only with an IDEMPOTENT trigger (a view/day button that sets a fixed state, or a
// picker whose "settled" signal is the popover being open) so an extra retry can't undo the result.
// It replaces the blind `waitForTimeout(...)` hydration waits with an observable readiness signal.
export async function clickUntil(trigger: Locator, settled: () => Promise<void>, timeout = 30_000) {
  await expect(async () => {
    await trigger.click();
    await settled();
  }).toPass({ timeout });
}

// A weekday ~14 days out at 12:00 UTC. Staff work Mon–Fri 09:00–17:00, so a weekday midday is inside
// business hours. Using a FUTURE day makes the "next free slot" suggestion deterministic: findNextFree
// floors at max(dayStart, now), so on a future day it starts at open time (09:00) instead of "now" —
// otherwise the test flakes on evenings/weekends when no slot fits before closing today.
export function futureWeekdayNoonUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

// Log in as the seeded owner. Before hydration React can re-mount and wipe our input, so instead of a
// fixed sleep we re-fill until the value STICKS — that persistence is the signal the form is live.
export async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(async () => {
    await page.getByLabel("Email").fill("owner@aesthetech.com");
    await page.getByLabel("Password").fill("password123");
    await expect(page.getByLabel("Email")).toHaveValue("owner@aesthetech.com", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  // Race the navigation with the submit (dev-server route compiles can be slow on the first hit).
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 90_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}
