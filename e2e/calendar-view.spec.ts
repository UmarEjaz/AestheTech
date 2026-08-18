import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, escapeRegExp, clickUntil, futureWeekdaySlot } from "./helpers";

// End-to-end coverage for the FullCalendar-based Calendar view: our appointment-fetching + event
// rendering + toolbar navigation + click-to-open-details (i.e. OUR integration around FullCalendar,
// not the library's internals). Needs the dev server on :3001 and a seeded DB (`npm run db:seed`).

loadEnv();
const prisma = new PrismaClient();

let apptId: string;
let clientName: string;
let dayStepsFromToday: number;

test.beforeAll(async () => {
  // Reuse a seeded appointment's salon/client/service/staff pairing, then create a FRESH appointment
  // on a near-future weekday at 11:00 (salon-local) for this test to find — independent of seed rows.
  const seed = await prisma.appointment.findFirst({
    include: { services: { orderBy: { order: "asc" } }, client: true },
    orderBy: { createdAt: "asc" },
  });
  if (!seed || seed.services.length === 0) {
    throw new Error("No seeded appointment found — run `npm run db:seed` first.");
  }
  const settings = await prisma.settings.findFirst({
    where: { salonId: seed.salonId },
    select: { timezone: true },
  });
  const tz = settings?.timezone ?? "UTC";
  const svc = seed.services[0];
  clientName = `${seed.client.firstName}${seed.client.lastName ? ` ${seed.client.lastName}` : ""}`;

  const slot = futureWeekdaySlot(tz);
  const start = slot.start;
  const end = new Date(start.getTime() + svc.duration * 60_000);
  dayStepsFromToday = slot.dayStepsFromToday;

  const created = await prisma.appointment.create({
    data: {
      salonId: seed.salonId,
      clientId: seed.clientId,
      startTime: start,
      endTime: end,
      status: "SCHEDULED",
      services: {
        create: [
          {
            salonId: seed.salonId,
            serviceId: svc.serviceId,
            staffId: svc.staffId,
            price: svc.price,
            duration: svc.duration,
            order: 0,
            segmentStart: start,
            segmentEnd: end,
            active: true,
          },
        ],
      },
    },
  });
  apptId = created.id;
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
