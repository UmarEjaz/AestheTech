import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { login, clickUntil, openMenu } from "./helpers";

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
  // so sweep them all: sales first (items, invoice, payments and refunds cascade from Sale; loyalty transactions
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

test("checkout lands on the sale, Print sends only the receipt, and a cancelled part-paid bill reprints as CANCELLED with its refund", async ({ page }) => {
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
  const firstPrint = page.getByRole("menuitem", { name: /^print$/i });
  await openMenu(receiptMenu, firstPrint);
  await firstPrint.click();
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

  // Cancelling a part-paid bill: staff choose to refund what was paid, and the receipt then says the
  // bill is cancelled and the money refunded, never that it is still owed. The app only lets a bill
  // that still owes money be cancelled, so turn this one into a part-paid bill directly (its cash
  // payment cut to half the total), then cancel it the way staff do, from the invoice page.
  const saleUrl = page.url();
  const saleId = new URL(saleUrl).pathname.split("/").pop() ?? "";
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { saleId },
    select: { id: true, total: true, payments: { select: { id: true } } },
  });
  const half = Math.round(Number(invoice.total) * 50) / 100;
  await prisma.payment.update({ where: { id: invoice.payments[0].id }, data: { amount: half } });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_PAID", paidAt: null } });

  // The sale earned loyalty points (the seed has the program on), so the cancel has some to take back.
  const earned = await prisma.loyaltyTransaction.aggregate({ where: { saleId, type: "EARNED" }, _sum: { points: true } });
  expect(earned._sum.points ?? 0).toBeGreaterThan(0);

  await page.goto(`/dashboard/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });
  const cancelItem = page.getByRole("menuitem", { name: /cancel invoice/i });
  await openMenu(page.getByRole("button", { name: /more actions/i }), cancelItem);
  await cancelItem.click();
  const confirm = page.getByRole("button", { name: /^cancel invoice$/i });
  await expect(confirm).toBeDisabled(); // money was paid: staff must say what happens to it first
  await page.getByRole("radio", { name: /^refund/i }).click();
  await confirm.click();
  await expect(page.getByText(/cancelled\. .+ refunded to/i)).toBeVisible();
  await expect.poll(async () => (await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.status).toBe("CANCELLED");
  // Dated, so reports take the cancelled bill off revenue on the day it was cancelled.
  expect((await prisma.invoice.findUnique({ where: { id: invoice.id } }))?.cancelledAt).toBeInstanceOf(Date);
  const refunds = await prisma.refund.findMany({ where: { invoiceId: invoice.id }, select: { amount: true } });
  expect(refunds.map((r) => Number(r.amount))).toEqual([half]);
  // The service wasn't given, so every loyalty point this sale earned is taken back again.
  const points = await prisma.loyaltyTransaction.aggregate({
    where: { saleId, type: { in: ["EARNED", "ADJUSTMENT"] } },
    _sum: { points: true },
  });
  expect(points._sum.points ?? 0).toBe(0);

  await page.goto(saleUrl, { waitUntil: "domcontentloaded" });
  const printItem = page.getByRole("menuitem", { name: /^print$/i });
  await openMenu(receiptMenu, printItem);
  await printItem.click();
  await expect(overlay).toContainText(/\*\*\* CANCELLED \*\*\*/);
  await expect(overlay).not.toContainText("Balance Due");
  await expect(overlay.getByText(/^\S+ refunded$/)).toHaveCount(1); // the money line under CANCELLED
  await expect(page.locator("body")).toHaveClass(/receipt-printing/);
  await expect.poll(() => page.evaluate(() => (window as PrintStubWindow).__printCalls)).toBe(1); // fresh page
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(overlay).toHaveCount(0);
});
