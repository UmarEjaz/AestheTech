import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, seedAppointment, clickUntil } from "./helpers";

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
let svcDurationMin: number;

test.beforeAll(async () => {
  const seeded = await seedAppointment(prisma, 15); // 15:00 — distinct hour so fixtures can't collide
  apptId = seeded.apptId;
  salonTz = seeded.tz;
  svcDurationMin = seeded.durationMin;
});

test.afterAll(async () => {
  // Delete cascades to the appointment's services (onDelete: Cascade).
  if (apptId) {
    await prisma.appointment
      .delete({ where: { id: apptId } })
      .catch((e) => console.error(`Cleanup failed to delete appointment ${apptId}:`, e));
  }
  await prisma.$disconnect();
});

test.describe("Booking — edit with a custom start time", () => {
  test("saves an edited custom time and persists the new startTime", async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard/appointments/${apptId}/edit`, { waitUntil: "domcontentloaded" });
    // The service/staff are prefilled in edit mode, so the custom-time toggle is present in the SSR
    // HTML. Retry turning it on until the custom-time input appears — that's the signal the form has
    // hydrated (a click before then is dropped). No fixed sleep.
    const toggle = page.locator("#custom-time-toggle");
    await expect(toggle).toBeVisible();
    await clickUntil(toggle, () =>
      expect(page.getByLabel("Custom start time")).toBeVisible({ timeout: 1_000 })
    );
    // Type a bookable minute (12:20) within business hours.
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
    const updated = await prisma.appointment.findUniqueOrThrow({
      where: { id: apptId },
      include: { services: { orderBy: { order: "asc" } } },
    });
    expect(hhmmInTz(updated.startTime, salonTz)).toBe("12:20");
    // The end time and the service's busy-window (segment) must be recomputed from the new start.
    const expectedEnd = new Date(updated.startTime.getTime() + svcDurationMin * 60_000);
    expect(updated.endTime.getTime()).toBe(expectedEnd.getTime());
    expect(updated.services[0].segmentStart?.getTime()).toBe(updated.startTime.getTime());
    expect(updated.services[0].segmentEnd?.getTime()).toBe(expectedEnd.getTime());
  });
});
