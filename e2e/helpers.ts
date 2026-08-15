import { expect, type Page } from "@playwright/test";

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

// Log in as the seeded owner. Waits for the client login form to hydrate before filling — otherwise
// React re-mounts with empty state after our fill and submits blank credentials (bounces to /login).
export async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByLabel("Email").fill("owner@aesthetech.com");
  await page.getByLabel("Password").fill("password123");
  await expect(page.getByLabel("Email")).toHaveValue("owner@aesthetech.com");
  // Race the navigation with the submit (dev-server route compiles can be slow on the first hit).
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 90_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}
