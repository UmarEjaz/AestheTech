import { test, expect, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, futureWeekdayNoonUtc, clickUntil } from "./helpers";

// Live end-to-end test for the booking form's custom-time flow. Needs the dev server on :3001 and a
// seeded database (owner login + sample client/services/staff come from `npm run db:seed`).

loadEnv(); // DATABASE_URL, so this test process can verify + clean up what it books
const prisma = new PrismaClient();

let bookDay: Date;
let createdApptId: string | null = null; // the exact appointment this test books (for verify + cleanup)
let submittedAt: Date | undefined; // set just before booking; bounds both the poll and the cleanup fallback
// The booked time lands on `bookDay`'s weekday; the seed rows are ~14 days away, so a ±12h window
// around it isolates exactly the appointment(s) this test creates for verification + cleanup.
const bookedWindow = () => ({
  gte: new Date(bookDay.getTime() - 12 * 3_600_000),
  lte: new Date(bookDay.getTime() + 12 * 3_600_000),
});

test.beforeAll(async () => {
  // Verify seed data exists (login + sample client/services come from `npm run db:seed`) and read the
  // salon's real timezone for the weekday math (no hardcoded tz). We do NOT pin the appointment's
  // salonId in the poll/cleanup below: the owner belongs to more than one salon and the form books
  // into their ACTIVE salon, which may not be this row's salon — the future time window + createdAt
  // already isolate exactly the row this test creates.
  const seed = await prisma.appointment.findFirst({
    where: {
      salon: { userSalons: { some: { user: { email: "owner@aesthetech.com" }, isActive: true } } },
    },
    select: { salonId: true },
  });
  if (!seed) throw new Error("No seeded data for the owner's salon — run `npm run db:seed` first.");
  const settings = await prisma.settings.findFirst({
    where: { salonId: seed.salonId },
    select: { timezone: true },
  });
  bookDay = futureWeekdayNoonUtc(settings?.timezone ?? "UTC");
});

test.afterAll(async () => {
  // Normally we delete the exact row the poll captured. But if the poll never assigned an id (e.g. it
  // timed out) the booked appointment would otherwise be orphaned in the DB and skew later runs — so
  // fall back to the newest row this test created. Bounded by createdAt >= submittedAt so the fallback
  // can only ever hit a row THIS test created, never a pre-existing one in the same window.
  let idToDelete = createdApptId;
  if (!idToDelete && submittedAt) {
    const orphan = await prisma.appointment.findFirst({
      where: { startTime: bookedWindow(), createdAt: { gte: submittedAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    idToDelete = orphan?.id ?? null;
  }
  if (idToDelete) {
    await prisma.appointment
      .delete({ where: { id: idToDelete } })
      .catch((e) => console.error(`Cleanup failed to delete appointment ${idToDelete}:`, e));
  }
  await prisma.$disconnect();
});

// Pick a client, a service, and a staff member so the "When" section (with the custom-time toggle)
// appears.
async function fillBookingBasics(page: Page) {
  // Client picker (a controlled Radix popover). Retry the trigger until the popover actually opens —
  // a click before the form hydrates is dropped — then fill the cmdk search and pick the first match.
  const combobox = page.getByRole("combobox").first();
  const search = page.getByPlaceholder(/Search by name or phone/i);
  await clickUntil(combobox, () => expect(search).toBeVisible({ timeout: 1_000 }));
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
    await page.goto(`/dashboard/appointments/new?startTime=${encodeURIComponent(bookDay.toISOString())}`, {
      waitUntil: "domcontentloaded",
    });
    // The picker trigger is present in the SSR HTML; fillBookingBasics retries opening it until the
    // form has hydrated (no fixed sleep needed).
    await expect(page.getByText("Search or add a client")).toBeVisible();
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
    const bookBtn = page.getByRole("button", { name: /Book Appointment/i }).last();
    await expect(bookBtn).toBeEnabled();

    // Actually submit and confirm the appointment was created (exercises createAppointment, not just
    // validation): the success toast fires, then the row exists in the DB.
    // Only rows created after this can be the one we just booked. The 60s buffer absorbs clock skew
    // between this process and the database, which would otherwise hide the new row.
    submittedAt = new Date(Date.now() - 60_000);
    await bookBtn.click();
    await expect(page.getByText(/Appointment booked successfully/i)).toBeVisible();
    // Capture the exact appointment this test created (the browser flow doesn't return its id), then
    // verify by it — afterAll deletes only this row, never anything else in the window. Bound by
    // createdAt so a pre-existing row in the same window can't be matched (and then wrongly deleted).
    await expect
      .poll(async () => {
        const appt = await prisma.appointment.findFirst({
          where: { startTime: bookedWindow(), createdAt: { gte: submittedAt } },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        createdApptId = appt?.id ?? null;
        return createdApptId;
      })
      .not.toBeNull();
  });
});
