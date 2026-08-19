import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, escapeRegExp, clickUntil, seedAppointment } from "./helpers";

// End-to-end coverage for the FullCalendar-based Calendar view: our appointment-fetching + event
// rendering + toolbar navigation + click-to-open-details (i.e. OUR integration around FullCalendar,
// not the library's internals). Needs the dev server on :3001 and a seeded DB (`npm run db:seed`).

loadEnv();
const prisma = new PrismaClient();

let apptId: string;
let clientName: string;
let dayStepsFromToday: number;

test.beforeAll(async () => {
  const seeded = await seedAppointment(prisma, 11); // 11:00 — distinct hour so fixtures can't collide
  apptId = seeded.apptId;
  clientName = seeded.clientName;
  dayStepsFromToday = seeded.dayStepsFromToday;
});

test.afterAll(async () => {
  if (apptId) {
    await prisma.appointment.delete({ where: { id: apptId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

test.describe("Calendar view — appointment rendering", () => {
  test("shows the appointment on the calendar day and opens its details", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/appointments", { waitUntil: "domcontentloaded" });

    // Default is the (FullCalendar) Calendar view; switch to the Day span — retry until the button
    // reflects its pressed state, which also confirms the toolbar hydrated (idempotent trigger).
    const dayBtn = page.getByRole("button", { name: /^day$/i });
    await clickUntil(dayBtn, () =>
      expect(dayBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 })
    );
    await expect(page.locator(".fc").first()).toBeVisible(); // calendar grid rendered
    for (let i = 0; i < dayStepsFromToday; i++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }

    // The appointment renders as an event on this day (proves fetch + FullCalendar integration).
    const event = page.getByRole("button", { name: new RegExp(escapeRegExp(clientName), "i") }).first();
    await expect(event).toBeVisible();

    // Clicking it opens the details modal for that appointment.
    await event.click();
    await expect(page.getByText(/Details for the appointment with/i)).toBeVisible();
  });
});
