import { test, expect, type Page } from "@playwright/test";

// Live end-to-end test for the booking form's custom-time flow. Needs the dev server on :3001 and a
// seeded database (owner login + sample client/services/staff come from `npm run db:seed`).

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toBeVisible();
  // Let the client login form hydrate before filling — otherwise React re-mounts with empty state
  // after our fill and submits blank credentials (bounces back to /login).
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

// Pick a client, a service, and a staff member so the "When" section (with the custom-time toggle)
// appears.
async function fillBookingBasics(page: Page) {
  // Client picker (a controlled Radix popover). Click the trigger, then WAIT for the popover to open
  // (opening depends on the form being hydrated), fill the cmdk search, and pick the first match.
  await page.getByRole("combobox").first().click();
  const search = page.getByPlaceholder(/Search by name or phone/i);
  await search.waitFor({ state: "visible" });
  await search.fill("Jennifer");
  await page.getByRole("option").first().click();
  // Service + staff selects.
  await page.getByText("Select a service").click();
  await page.getByRole("option").first().click();
  await page.getByText("Select staff").click();
  await page.getByRole("option").first().click();
}

test.describe("Booking — custom start time", () => {
  test("rejects an out-of-hours time, suggests the next free slot, and accepts it", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/appointments/new", { waitUntil: "domcontentloaded" });
    // Let the heavy booking form hydrate before interacting (otherwise the picker's open-handler
    // isn't attached yet and clicking the trigger only focuses it).
    await expect(page.getByText("Search or add a client")).toBeVisible();
    await page.waitForTimeout(2500);
    await fillBookingBasics(page);

    // Turn on custom time and type a time after closing.
    await page.locator("#custom-time-toggle").click();
    const timeInput = page.getByLabel("Custom start time");
    await timeInput.fill("20:00");

    // The server check should reject it as outside business hours and offer a next-free slot.
    // (The message shows both in the card and the bottom booking hint, so match the first.)
    await expect(page.getByText(/Outside business hours/i).first()).toBeVisible();
    const useBtn = page.getByRole("button", { name: /^Use / });
    await expect(useBtn).toBeVisible();

    // Applying the suggestion should make the time valid and enable booking.
    await useBtn.click();
    await expect(page.getByText(/This time is available/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Book Appointment/i }).last()).toBeEnabled();
  });
});
