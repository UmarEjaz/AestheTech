import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/settings", () => ({ getSettings: vi.fn() }));

import { recordRefund, refundSettings, undoCancelledSale, type RefundableInvoice } from "./refund-core";
import { getSettings } from "@/lib/actions/settings";
import type { Prisma } from "@prisma/client";

const refundCreate = vi.fn();
const pointsFind = vi.fn();
const pointsUpdate = vi.fn();
const loyaltyCreate = vi.fn();
const productUpdate = vi.fn();
const loyaltyUpdateMany = vi.fn();
const loyaltyUpdate = vi.fn();
const tx = {
  refund: { create: refundCreate },
  loyaltyPoints: { findUnique: pointsFind, update: pointsUpdate },
  loyaltyTransaction: { create: loyaltyCreate, updateMany: loyaltyUpdateMany, update: loyaltyUpdate },
  product: { update: productUpdate },
} as unknown as Prisma.TransactionClient;

// A $100 invoice that earned 10 points and sold 2 of one product.
function invoice(
  refunds: Array<{ amount: string; pointsReversed: number }> = [],
  extraPoints: Array<{ type: string; points: number; id?: string; description?: string | null }> = []
): RefundableInvoice {
  return {
    id: "inv1",
    invoiceNumber: "INV-000123",
    saleId: "sale1",
    total: "100.00",
    payments: [{ amount: "100.00" }],
    refunds,
    sale: {
      clientId: "c1",
      items: [{ productId: "prod1", quantity: 2 }],
      loyaltyTransactions: [{ type: "EARNED", points: 10 }, ...extraPoints],
    },
  } as unknown as RefundableInvoice;
}

const base = { userId: "u1", salonId: "salon_1", thresholds: { goldThreshold: 500, platinumThreshold: 1000 }, currencyCode: "USD" };

beforeEach(() => {
  vi.clearAllMocks();
  refundCreate.mockResolvedValue({ id: "r1" });
  pointsFind.mockResolvedValue({ balance: 50 });
});

describe("recordRefund", () => {
  it("records a part refund, takes back a matching share of the points, and leaves stock alone", async () => {
    const res = await recordRefund(tx, { ...base, invoice: invoice(), amount: 30, reason: "Invoice cancelled" });
    expect(res).toEqual({ refundId: "r1", pointsReversed: 3, pointsTaken: 3, pointsReturned: 0, isFullRefund: false });
    expect(refundCreate).toHaveBeenCalledWith({
      data: { salonId: "salon_1", invoiceId: "inv1", amount: 30, reason: "Invoice cancelled", refundedById: "u1", pointsReversed: 3 },
    });
    expect(pointsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balance: 47 }) }));
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("on a full refund takes back every remaining point and puts the stock back", async () => {
    const res = await recordRefund(tx, { ...base, invoice: invoice([{ amount: "40.00", pointsReversed: 4 }]), amount: 60 });
    expect(res).toMatchObject({ pointsReversed: 6, isFullRefund: true });
    expect(productUpdate).toHaveBeenCalledWith({ where: { id: "prod1" }, data: { stock: { increment: 2 } } });
    // Every earned point is back off the balance, so they must not expire off it again later.
    expect(loyaltyUpdateMany).toHaveBeenCalledWith({
      where: { saleId: "sale1", type: { in: ["EARNED", "BONUS"] }, expiresAt: { not: null } },
      data: { expiresAt: null },
    });
    expect(loyaltyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ points: -6, description: "Points reversed due to refund on invoice INV-000123" }),
    });
  });

  it("on a full refund also gives back points spent on the bill and takes back its birthday bonus", async () => {
    // Balance 5 now (spent down on this bill): +100 back first, then the 10 earned and 50 bonus come off.
    pointsFind.mockResolvedValueOnce({ balance: 5 }).mockResolvedValueOnce({ balance: 105 });
    const mixed = invoice([], [
      { type: "REDEEMED", points: -100 },
      { type: "BONUS", points: 50, id: "b1", description: "Birthday bonus 2026" },
    ]);
    expect(await recordRefund(tx, { ...base, invoice: mixed, amount: 100 })).toEqual({
      refundId: "r1",
      pointsReversed: 10, // the earned points; the bonus isn't part of a refund's share
      pointsTaken: 60,
      pointsReturned: 100,
      isFullRefund: true,
    });
    expect(loyaltyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ points: 100, description: "Points returned: invoice INV-000123 refunded" }),
    });
    // The bonus came off, so the client can still get one this year.
    expect(loyaltyUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { description: "Birthday bonus 2026 (reversed: invoice INV-000123 refunded)" },
    });
  });

  it("on a full refund takes back nothing more once the earned points have expired", async () => {
    const expired = invoice([{ amount: "40.00", pointsReversed: 4 }]);
    Object.assign(expired.sale.loyaltyTransactions[0], { expiredAt: new Date("2026-09-01T00:00:00Z") });
    expect(await recordRefund(tx, { ...base, invoice: expired, amount: 60 })).toMatchObject({ pointsReversed: 0, pointsTaken: 0 });
  });

  it("counts only earned points toward a refund's share, not a birthday bonus or spent points", async () => {
    const mixed = invoice([], [{ type: "BONUS", points: 50 }, { type: "REDEEMED", points: -20 }]);
    expect(await recordRefund(tx, { ...base, invoice: mixed, amount: 30 })).toMatchObject({ pointsReversed: 3 });
    expect(loyaltyUpdateMany).not.toHaveBeenCalled(); // a part refund leaves the rest of the points to expire as normal
  });

  it("doesn't count change handed back on an overpaid deposit against what can be refunded", async () => {
    // $110 paid against the $100 bill; checkout handed $10 back as change. All $100 can still be refunded.
    const overpaid = { ...invoice([{ amount: "10.00", pointsReversed: 0 }]), payments: [{ amount: "110.00" }] } as unknown as RefundableInvoice;
    expect(await recordRefund(tx, { ...base, invoice: overpaid, amount: 100 })).toMatchObject({ isFullRefund: true });
    // ...but not a cent more.
    await expect(recordRefund(tx, { ...base, invoice: overpaid, amount: 101 })).rejects.toThrow(/\$100\.00 that can still be refunded/);
  });

  it("refuses to refund more than is left", async () => {
    await expect(recordRefund(tx, { ...base, invoice: invoice([{ amount: "90.00", pointsReversed: 9 }]), amount: 20 }))
      .rejects.toThrow("Refund amount exceeds the $10.00 that can still be refunded");
    expect(refundCreate).not.toHaveBeenCalled();
  });
});

describe("recordRefund — loyalty edge cases", () => {
  it("records the refund even when the client has no points record", async () => {
    pointsFind.mockResolvedValue(null);
    const res = await recordRefund(tx, { ...base, invoice: invoice(), amount: 30 });
    expect(res).toMatchObject({ pointsReversed: 3, pointsTaken: 0 }); // nothing on a balance to take from
    expect(pointsUpdate).not.toHaveBeenCalled();
    expect(loyaltyCreate).not.toHaveBeenCalled();
  });

  it("re-tiers the client from the new balance", async () => {
    pointsFind.mockResolvedValue({ balance: 502 });
    await recordRefund(tx, { ...base, invoice: invoice(), amount: 30 });
    expect(pointsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balance: 499, tier: "MEMBER" }) })
    );
  });
});

type UndoInput = Parameters<typeof undoCancelledSale>[1];
const undo = (over: Partial<UndoInput> = {}): ReturnType<typeof undoCancelledSale> =>
  undoCancelledSale(tx, { ...base, invoice: invoice(), pointsAlreadyReversed: 0, returnSpentPoints: true, ...over });

describe("undoCancelledSale", () => {
  it("takes back every point the bill earned that no refund took, and restocks its products", async () => {
    expect(await undo({ pointsAlreadyReversed: 3 })).toEqual({ pointsTaken: 7, pointsReturned: 0 });
    expect(pointsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balance: 43 }) }));
    expect(loyaltyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        points: -7,
        type: "ADJUSTMENT",
        salonId: "salon_1",
        description: "Points reversed: invoice INV-000123 cancelled",
      }),
    });
    expect(productUpdate).toHaveBeenCalledWith({ where: { id: "prod1" }, data: { stock: { increment: 2 } } });
  });

  it("takes nothing more once refunds already took every point, but still restocks", async () => {
    expect(await undo({ pointsAlreadyReversed: 10 })).toEqual({ pointsTaken: 0, pointsReturned: 0 });
    expect(pointsUpdate).not.toHaveBeenCalled();
    expect(productUpdate).toHaveBeenCalledOnce();
  });

  it("takes back a birthday bonus the bill triggered, and stops the bill's points expiring later", async () => {
    pointsFind.mockResolvedValue({ balance: 100 });
    expect(await undo({ invoice: invoice([], [{ type: "BONUS", points: 50 }]) })).toEqual({ pointsTaken: 60, pointsReturned: 0 });
    expect(loyaltyCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ points: -60 }) });
    // Already taken back, so an expiry run must not take them off the balance a second time.
    expect(loyaltyUpdateMany).toHaveBeenCalledWith({
      where: { saleId: "sale1", type: { in: ["EARNED", "BONUS"] }, expiresAt: { not: null } },
      data: { expiresAt: null },
    });
  });

  it("gives back points spent on the bill first, then takes back what it earned", async () => {
    // Balance 5 now (spent down on this bill). +100 back first gives 105, so all 10 earned points can come off.
    pointsFind.mockResolvedValueOnce({ balance: 5 }).mockResolvedValueOnce({ balance: 105 });
    const spent = invoice([], [{ type: "REDEEMED", points: -100 }]);
    expect(await undo({ invoice: spent })).toEqual({ pointsTaken: 10, pointsReturned: 100 });
    expect(pointsUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ balance: 105 }) }));
    expect(pointsUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ balance: 95 }) }));
    expect(loyaltyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ points: 100, type: "ADJUSTMENT", description: "Points returned: invoice INV-000123 cancelled" }),
    });
  });

  it("marks a taken-back birthday bonus as reversed, so the client can still get one this year", async () => {
    pointsFind.mockResolvedValue({ balance: 100 });
    const bonus = { type: "BONUS", points: 50, id: "b1", description: "Birthday bonus 2026" };
    await undo({ invoice: invoice([], [bonus]) });
    expect(loyaltyUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { description: "Birthday bonus 2026 (reversed: invoice INV-000123 cancelled)" },
    });
    // Checkout looks for exactly "Birthday bonus 2026", which no longer matches.
    loyaltyUpdate.mockClear();
    await undo({ invoice: invoice([], [{ ...bonus, description: "Birthday bonus 2026 (reversed: invoice X cancelled)" }]) });
    expect(loyaltyUpdate).not.toHaveBeenCalled();
  });

  it("keeps the bonus counted for the year when the client had already spent it (nothing came off)", async () => {
    pointsFind.mockResolvedValue({ balance: 0 });
    await undo({ invoice: invoice([], [{ type: "BONUS", points: 50, id: "b1", description: "Birthday bonus 2026" }]) });
    expect(loyaltyUpdate).not.toHaveBeenCalled();
  });

  it("never takes back points the expiry job already took off the balance", async () => {
    const expired = invoice([], [{ type: "BONUS", points: 50, id: "b1", description: "Birthday bonus 2026" }]);
    expired.sale.loyaltyTransactions.forEach((t) => Object.assign(t, { expiredAt: new Date("2026-09-01T00:00:00Z") }));
    expect(await undo({ invoice: expired })).toEqual({ pointsTaken: 0, pointsReturned: 0 });
    expect(pointsUpdate).not.toHaveBeenCalled();
    // The bonus was lost to expiry, not taken back here, so it still counts for the year.
    expect(loyaltyUpdate).not.toHaveBeenCalled();
  });

  it("keeps the spent points spent when the salon keeps the money", async () => {
    const spent = invoice([], [{ type: "REDEEMED", points: -100 }]);
    expect(await undo({ invoice: spent, returnSpentPoints: false })).toEqual({ pointsTaken: 10, pointsReturned: 0 });
    expect(pointsUpdate).toHaveBeenCalledOnce();
  });
});

describe("undoCancelledSale — edge cases", () => {
  it("reports only the points actually taken when the client already spent some", async () => {
    pointsFind.mockResolvedValue({ balance: 4 });
    expect(await undo()).toEqual({ pointsTaken: 4, pointsReturned: 0 });
    expect(pointsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balance: 0 }) }));
    // The points history records what really came off, so it still adds up to the balance.
    expect(loyaltyCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ points: -4 }) });
  });

  it("writes no change and no history row when the balance is already zero", async () => {
    pointsFind.mockResolvedValue({ balance: 0 });
    expect(await undo()).toEqual({ pointsTaken: 0, pointsReturned: 0 });
    expect(pointsUpdate).not.toHaveBeenCalled();
    expect(loyaltyCreate).not.toHaveBeenCalled();
  });
});

describe("refundSettings", () => {
  it("uses the salon's tier thresholds and currency, or the defaults when settings can't be read", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      success: true,
      data: { goldThreshold: 300, platinumThreshold: 900, currencyCode: "GBP" },
    } as Awaited<ReturnType<typeof getSettings>>);
    expect(await refundSettings()).toEqual({ thresholds: { goldThreshold: 300, platinumThreshold: 900 }, currencyCode: "GBP" });
    vi.mocked(getSettings).mockResolvedValueOnce({ success: false, error: "Unauthorized" });
    expect(await refundSettings()).toEqual({ thresholds: { goldThreshold: 500, platinumThreshold: 1000 }, currencyCode: "USD" });
  });
});
