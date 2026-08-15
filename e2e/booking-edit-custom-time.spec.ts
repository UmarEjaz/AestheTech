import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, futureWeekdayNoonUtc } from "./helpers";

// End-to-end proof that a custom start time picked while EDITING an existing appointment survives the
// Save button — i.e. the validated time actually reaches updateAppointment and persists to the DB.
// Needs the dev server on :3001 and a seeded database (`npm run db:seed`).

// Load DATABASE_URL so this (separate) test process can talk to the same DB the dev server uses.
loadEnv();
const prisma = new PrismaClient();

// The stored startTime is a UTC instant; read it back in the salon's timezone as "HH:mm".
function hhmmInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

let apptId: string;
let salonTz: string;

test.beforeAll(async () => {
  // Reuse a seeded appointment's salon/client/service/staff pairing (guaranteed valid), then create a
  // FRESH appointment on a future weekday for this test to edit — independent of the seed rows.
  const seed = await prisma.appointment.findFirst({
    include: { services: true },
    orderBy: { createdAt: "asc" },
  });
  if (!seed || seed.services.length === 0) {
    throw new Error("No seeded appointment found — run `npm run db:seed` first.");
  }
  const settings = await prisma.settings.findFirst({
    where: { salonId: seed.salonId },
    select: { timezone: true },
  });
  salonTz = settings?.timezone ?? "UTC";
  const svc = seed.services[0];
  const start = futureWeekdayNoonUtc();
  const end = new Date(start.getTime() + svc.duration * 60_000);
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
  // Delete cascades to the appointment's services (onDelete: Cascade).
  if (apptId) {
    await prisma.appointment.delete({ where: { id: apptId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

test.describe("Booking — edit with a custom start time", () => {
  test("saves an edited custom time and persists the new startTime", async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard/appointments/${apptId}/edit`, { waitUntil: "domcontentloaded" });
    // The service/staff are prefilled in edit mode, so the custom-time toggle is present. Wait for it,
    // then let the heavy form hydrate before clicking (otherwise the handler isn't attached yet).
    await expect(page.locator("#custom-time-toggle")).toBeVisible();
    await page.waitForTimeout(2500);

    // Switch on custom time and type a bookable minute (12:20) within business hours.
    await page.locator("#custom-time-toggle").click();
    await page.getByLabel("Custom start time").fill("12:20");

    // The server confirms it's available.
    await expect(page.getByText(/This time is available/i)).toBeVisible();

    // Save, and wait for the redirect back to the appointments list (not the /edit page).
    await Promise.all([
      page.waitForURL(/\/dashboard\/appointments(\?|$)/, { timeout: 90_000 }),
      page.getByRole("button", { name: /Update Appointment/i }).last().click(),
    ]);

    // The chosen custom time must have persisted: submit → updateAppointment → DB. Compare in the
    // salon's timezone, since startTime is stored as a UTC instant.
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: apptId } });
    expect(hhmmInTz(updated.startTime, salonTz)).toBe("12:20");
  });
});
