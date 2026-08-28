import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, escapeRegExp, clickUntil, seedAppointment } from "./helpers";

// End-to-end proof of this PR's headline feature: dragging an appointment from one staff lane to
// another (in the Staff / Day view) reassigns its provider and persists. Drag needs REAL pixel
// layout, so it can't run in jsdom — this drives the actual browser. Needs the dev server on :3001
// and a seeded DB (`npm run db:seed`).

loadEnv();
const prisma = new PrismaClient();

let apptId: string;
let currentStaffId: string;
let clientName: string;
let dayStepsFromToday: number;

test.beforeAll(async () => {
  const seeded = await seedAppointment(prisma, 13); // 13:00 — distinct hour so fixtures can't collide
  apptId = seeded.apptId;
  currentStaffId = seeded.staffId;
  clientName = seeded.clientName;
  dayStepsFromToday = seeded.dayStepsFromToday;
});

test.afterAll(async () => {
  if (apptId) {
    await prisma.appointment
      .delete({ where: { id: apptId } })
      .catch((e) => console.error(`Cleanup failed to delete appointment ${apptId}:`, e));
  }
  await prisma.$disconnect();
});

test.describe("Staff lanes — drag to reschedule", () => {
  test("dragging an appointment to another lane reassigns its provider and persists", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/appointments", { waitUntil: "domcontentloaded" });

    // Switch to the Staff (lane) view — retry until the button reflects its pressed state, which also
    // confirms the toolbar hydrated (idempotent: it sets a fixed view, so extra clicks are harmless).
    const staffBtn = page.getByRole("button", { name: /^staff$/i });
    await clickUntil(staffBtn, () =>
      expect(staffBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 })
    );
    const dayBtn = page.getByRole("button", { name: /^Day$/i });
    await clickUntil(dayBtn, () =>
      expect(dayBtn).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 })
    );
    // Lanes render once the view switched; wait for them before stepping the date.
    await expect(page.locator("[data-lane]").first()).toBeVisible();
    for (let i = 0; i < dayStepsFromToday; i++) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }

    // The appointment block (a button labelled with the client name) should be on this day.
    const block = page.getByRole("button", { name: new RegExp(escapeRegExp(clientName), "i") }).first();
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();

    // Pick a DIFFERENT, EMPTY staff lane as the drop target (an occupied lane would conflict at the
    // seeded hour, making a real reschedule look like a drag failure) and remember its id.
    const targetLane = page
      .locator(`[data-lane][data-staff-id]:not([data-staff-id="${currentStaffId}"])`)
      .filter({ hasNot: page.locator("button[aria-label]") })
      .first();
    await expect(targetLane).toBeVisible();
    await targetLane.scrollIntoViewIfNeeded(); // a far-off lane must be on-screen before we measure it
    const targetStaffId = await targetLane.getAttribute("data-staff-id");
    expect(targetStaffId).toBeTruthy();

    // Scrolling the target lane into view scrolls the grid horizontally, which can push the block
    // off-screen; confirm it's still hittable before measuring and pressing (a clearer failure than a
    // later timeout on an off-screen click target).
    await expect(block).toBeInViewport();
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
    // And no conflict/error toast slipped in (which would mean the drop landed on an occupied slot).
    await expect(page.getByText(/conflicts with another appointment/i)).toHaveCount(0);

    // The primary provider must have changed to the drop lane's staff, and it must be persisted.
    const updated = await prisma.appointment.findUniqueOrThrow({
      where: { id: apptId },
      include: { services: { orderBy: { order: "asc" }, select: { staffId: true } } },
    });
    expect(updated.services[0].staffId).toBe(targetStaffId);
    expect(updated.services[0].staffId).not.toBe(currentStaffId);
  });
});
