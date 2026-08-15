import { test, expect, type Page } from "@playwright/test";
import { login, futureWeekdayNoonUtc } from "./helpers";

// Live end-to-end test for the booking form's custom-time flow. Needs the dev server on :3001 and a
// seeded database (owner login + sample client/services/staff come from `npm run db:seed`).

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
    // Book on a future weekday (via ?startTime) so the "next free slot" suggestion is deterministic
    // — booking "today" flakes on evenings/weekends when nothing fits before the salon closes.
    const bookDay = futureWeekdayNoonUtc().toISOString();
    await page.goto(`/dashboard/appointments/new?startTime=${encodeURIComponent(bookDay)}`, {
      waitUntil: "domcontentloaded",
    });
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
