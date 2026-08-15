import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { login } from "./helpers";

// End-to-end proof of this PR's headline feature: dragging an appointment from one staff lane to
// another (in the Staff / Day view) reassigns its provider and persists. Drag needs REAL pixel
// layout, so it can't run in jsdom — this drives the actual browser. Needs the dev server on :3001
// and a seeded DB (`npm run db:seed`).

loadEnv();
const prisma = new PrismaClient();

const dayISOInTz = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d); // "yyyy-mm-dd"
const utcDayMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

let apptId: string;
let currentStaffId: string;
let clientName: string;
let dayStepsFromToday: number;

test.beforeAll(async () => {
  // Reuse a seeded appointment's salon/client/service/staff pairing, then create a FRESH appointment
  // on a near-future weekday at 11:00 (salon-local) so it lands inside business hours (09–19) and a
  // few day-steps from "today" — independent of the seed rows.
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
  currentStaffId = svc.staffId;
  clientName = `${seed.client.firstName}${seed.client.lastName ? ` ${seed.client.lastName}` : ""}`;

  // Soonest weekday at least 3 days out (salon tz) — small enough to reach with a few "Next" clicks.
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

test.describe("Staff lanes — drag to reschedule", () => {
  test("dragging an appointment to another lane reassigns its provider and persists", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/appointments", { waitUntil: "domcontentloaded" });
    // Let the calendar page hydrate before clicking the client-rendered view toggles.
    await page.waitForTimeout(2500);

    // Switch to the Staff (lane) view, Day span, then step to the appointment's day.
    await page.getByRole("button", { name: /^staff$/i }).click();
    await page.getByRole("button", { name: /^Day$/i }).click();
    // Wait for the lanes to render (confirms the view actually switched) before stepping the date.
    await expect(page.locator("[data-lane]").first()).toBeVisible();
    for (let i = 0; i < dayStepsFromToday; i++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }

    // The appointment block (a button labelled with the client name) should be on this day.
    const block = page.getByRole("button", { name: new RegExp(clientName, "i") }).first();
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();

    // Pick a DIFFERENT staff lane as the drop target and remember its id for the assertion.
    const targetLane = page
      .locator(`[data-lane][data-staff-id]:not([data-staff-id="${currentStaffId}"])`)
      .first();
    await expect(targetLane).toBeVisible();
    const targetStaffId = await targetLane.getAttribute("data-staff-id");
    expect(targetStaffId).toBeTruthy();

    const from = await block.boundingBox();
    const to = await targetLane.boundingBox();
    if (!from || !to) throw new Error("Could not measure the block or target lane.");

    // Drag: press on the block, move past the drag threshold, then across to the target lane at the
    // SAME height (so the time stays roughly put and only the provider/lane changes), and release.
    const startX = from.x + from.width / 2;
    const startY = from.y + 8;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY + 12, { steps: 3 }); // exceed the 4px drag threshold
    await page.mouse.move(to.x + to.width / 2, startY, { steps: 12 });
    await page.mouse.up();

    // A success toast confirms the reschedule went through.
    await expect(page.getByText(/rescheduled to/i)).toBeVisible();

    // The primary provider must have changed to the drop lane's staff, and it must be persisted.
    const updated = await prisma.appointment.findUniqueOrThrow({
      where: { id: apptId },
      include: { services: { orderBy: { order: "asc" }, select: { staffId: true } } },
    });
    expect(updated.services[0].staffId).toBe(targetStaffId);
    expect(updated.services[0].staffId).not.toBe(currentStaffId);
  });
});
