import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { login, escapeRegExp, clickUntil } from "./helpers";

// End-to-end coverage for the FullCalendar-based Calendar view: our appointment-fetching + event
// rendering + toolbar navigation + click-to-open-details (i.e. OUR integration around FullCalendar,
// not the library's internals). Needs the dev server on :3001 and a seeded DB (`npm run db:seed`).

loadEnv();
const prisma = new PrismaClient();

const dayISOInTz = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d); // "yyyy-mm-dd"
const utcDayMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

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

  let probe = new Date(Date.now() + 3 * 86_400_000);
  for (let i = 0; i < 7; i++) {
    const wd = new Date(utcDayMs(dayISOInTz(probe, tz))).getUTCDay();
    if (wd !== 0 && wd !== 6) break;
    probe = new Date(probe.getTime() + 86_400_000);
  }
  const [ty, tm, td] = dayISOInTz(probe, tz).split("-").map(Number);
  const start = new Date(new TZDate(ty, tm - 1, td, 11, 0, 0, tz).getTime()); // 11:00 salon-local
  const end = new Date(start.getTime() + svc.duration * 60_000);
  dayStepsFromToday = Math.round(
    (utcDayMs(dayISOInTz(start, tz)) - utcDayMs(dayISOInTz(new Date(), tz))) / 86_400_000
  );

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
