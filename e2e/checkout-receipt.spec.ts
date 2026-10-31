import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, clickUntil } from "./helpers";

// Live end-to-end test for the checkout → receipt hand-off: completing a sale must land on that sale's
// page (not the sales list), where the customer receipt is one click away, and "Print" must open the
// print dialog with ONLY the receipt on paper. Needs the server on :3001 and a seeded database (owner
// login, an active service and a service provider come from `npm run db:seed`).

// The print stub's counter, kept out of the app's own Window type (tsconfig includes every .ts file).
type PrintStubWindow = Window & { __printCalls?: number };

loadEnv(); // DATABASE_URL, so this test process can clean up what it sells
const prisma = new PrismaClient();

// A throwaway walk-in client, unique to this run so cleanup can never touch real data. (Walk-ins still
// earn points while the loyalty program is on; those rows cascade from the client below.)
const WALK_IN_PREFIX = "E2E Receipt ";
const WALK_IN_NAME = `${WALK_IN_PREFIX}${Date.now()}`;

test.afterAll(async () => {
  // Every walk-in with this prefix is ours — this run's, plus any left by a run killed before cleanup —
  // so sweep them all: sales first (items, invoice and payments cascade from Sale; loyalty transactions
  // detach), then the client (its loyalty rows cascade).
  const clients = await prisma.client.findMany({
    where: { firstName: { startsWith: WALK_IN_PREFIX }, isWalkIn: true },
    select: { id: true },
  });
  for (const client of clients) {
    await prisma.sale
      .deleteMany({ where: { clientId: client.id } })
      .catch((e) => console.error(`Cleanup failed to delete sales for walk-in client ${client.id}:`, e));
    await prisma.client
      .delete({ where: { id: client.id } })
      .catch((e) => console.error(`Cleanup failed to delete walk-in client ${client.id}:`, e));
  }
  await prisma.$disconnect();
});

test("checkout lands on the sale, and Print sends only the receipt to the print dialog", async ({ page }) => {
  // Stand in for the browser's print dialog: count the calls; the test fires `afterprint` itself, the
  // way a closed dialog would, so the overlay's lifetime can be asserted on both sides of it.
  await page.addInitScript(() => {
    const w = window as PrintStubWindow;
    w.__printCalls = 0;
    w.print = (): void => {
      w.__printCalls = (w.__printCalls ?? 0) + 1;
    };
  });

  await login(page);
  await page.goto("/dashboard/sales/new", { waitUntil: "domcontentloaded" });

  // Walk-in client. Retry the toggle until its form shows — a click before hydration is dropped.
  const walkInToggle = page.getByRole("button", { name: /walk-in client/i });
  const nameInput = page.getByLabel(/client name/i);
  await clickUntil(walkInToggle, () => expect(nameInput).toBeVisible({ timeout: 1_000 }));
  await nameInput.fill(WALK_IN_NAME);

  // One service. The staff picker already defaults to the first provider, so only the service is chosen.
  await page.getByText("Select a service", { exact: true }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(/1 item$/)).toBeVisible(); // the cart counts it

  // Pay in full, in cash.
  await page.getByRole("button", { name: /proceed to payment/i }).click();
  await page.getByRole("button", { name: /pay with cash/i }).click();

  // Lands on the completed sale (never the sales list), where the receipt is right there.
  await page.waitForURL(/\/dashboard\/sales\/(?!new(?:[/?#]|$))[^/?#]+(?:[?#].*)?$/, { timeout: 90_000 });
  const receiptMenu = page.getByRole("button", { name: /^receipt$/i });
  await expect(receiptMenu).toBeVisible();

  // Print: the receipt overlay mounts in <body> with this sale's details, <body> is marked so the print
  // CSS hides everything else, and the dialog is opened.
  await receiptMenu.click();
  await page.getByRole("menuitem", { name: /^print$/i }).click();
  const overlay = page.locator(".receipt-print-root");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toContainText("Walk-in");
  await expect(overlay).toContainText(/\*\*\* PAID \*\*\*/);
  await expect(page.locator("body")).toHaveClass(/receipt-printing/);
  await expect.poll(() => page.evaluate(() => (window as PrintStubWindow).__printCalls)).toBe(1);

  // Closing the dialog puts the page back exactly as it was.
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(overlay).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/receipt-printing/);
});
