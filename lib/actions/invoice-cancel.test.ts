import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

// ---- Fakes for the server action's dependencies (no real DB / auth / redis) ----
const mockCheckAuth = vi.fn();
const mockFindFirst = vi.fn();
const mockUpdateMany = vi.fn();
const mockRecordRefund = vi.fn();
const mockLogAudit = vi.fn();
const mockUndoCancelledSale = vi.fn();
const tx = { invoice: { findFirst: mockFindFirst, updateMany: mockUpdateMany } };

vi.mock("@/lib/auth-helpers", () => ({ checkAuth: (...a: unknown[]) => mockCheckAuth(...a) }));
vi.mock("./audit", () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));
vi.mock("@/lib/redis", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/refund-core", () => ({
  refundInvoiceInclude: {},
  RefundRefusal: class RefundRefusal extends Error {},
  INVOICE_CHANGED: "This invoice just changed. Please reload and try again.",
  refundSettings: vi.fn(async () => ({ thresholds: { goldThreshold: 500, platinumThreshold: 1000 }, currencyCode: "USD" })),
  recordRefund: (...a: unknown[]) => mockRecordRefund(...a),
  undoCancelledSale: (...a: unknown[]) => mockUndoCancelledSale(...a),
}));
const mockTransaction = vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (...a: Parameters<typeof mockTransaction>) => mockTransaction(...a) },
}));

import { cancelInvoice } from "./invoice-cancel";
import { RefundRefusal } from "@/lib/refund-core";

const actor = { userId: "u1", salonId: "salon_1", role: "OWNER" };
const CHANGED = "This invoice just changed. Please reload and try again.";

/** An invoice of $100 with the given payments and refunds. */
function invoice(status: string, paid: number[] = [], refunded: number[] = []): Record<string, unknown> {
  return {
    id: "inv1",
    invoiceNumber: "INV-000123",
    saleId: "sale1",
    clientId: "c1",
    status,
    total: "100.00",
    payments: paid.map((amount) => ({ amount: String(amount) })),
    refunds: refunded.map((amount) => ({ amount: String(amount), pointsReversed: 0 })),
  };
}

afterEach((): void => {
  vi.restoreAllMocks(); // undo the console.error silencing spies
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuth.mockResolvedValue(actor); // has both the cancel and the refund permission
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockRecordRefund.mockResolvedValue({ refundId: "r1", pointsReversed: 3, pointsTaken: 3, pointsReturned: 0, isFullRefund: false });
  mockUndoCancelledSale.mockResolvedValue({ pointsTaken: 7, pointsReturned: 0 }); // the rest of the bill's points
});

describe("cancelInvoice", () => {
  it("refuses without the cancel permission", async () => {
    mockCheckAuth.mockResolvedValueOnce(null);
    expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({ success: false, error: "Unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("cancels an unpaid bill without asking about money, scoped to the signed-in salon", async () => {
    mockFindFirst.mockResolvedValue(invoice("PENDING"));
    expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({
      success: true,
      data: { refunded: 0, kept: 0, pointsTakenBack: 7, pointsReturned: 0 },
    });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv1", salonId: "salon_1" } }));
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv1", salonId: "salon_1" }),
        // The cancel date is what reports use to take the unpaid part off revenue that day.
        data: { status: "CANCELLED", cancelledAt: expect.any(Date) },
      })
    );
    expect(mockRecordRefund).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "INVOICE_CANCELLED", salonId: "salon_1" }));
    // Nothing was paid, so any points spent on it go back to the client.
    expect(mockUndoCancelledSale).toHaveBeenCalledWith(tx, expect.objectContaining({ returnSpentPoints: true }));
  });

  it("reports the spent points it gave back", async () => {
    mockFindFirst.mockResolvedValue(invoice("PENDING"));
    mockUndoCancelledSale.mockResolvedValueOnce({ pointsTaken: 7, pointsReturned: 100 });
    expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({
      success: true,
      data: { refunded: 0, kept: 0, pointsTakenBack: 7, pointsReturned: 100 },
    });
  });

  it("will not cancel a part-paid bill until staff say what happens to the money", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    const res = await cancelInvoice({ invoiceId: "inv1", expectedPaid: 30 });
    expect(res).toEqual({ success: false, error: "Choose whether to refund or keep the money already paid." });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps the money as a cancellation fee when asked", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [10, 20]));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "KEEP", expectedPaid: 30 })).toEqual({
      success: true,
      data: { refunded: 0, kept: 30, pointsTakenBack: 7, pointsReturned: 0 },
    });
    expect(mockRecordRefund).not.toHaveBeenCalled();
    // Keeping the money still undoes the sale: all its points come back off, products go back in stock.
    expect(mockUndoCancelledSale).toHaveBeenCalledWith(
      tx,
      // ...and points the client spent on it stay spent, like the money.
      expect.objectContaining({ pointsAlreadyReversed: 0, returnSpentPoints: false, salonId: "salon_1" })
    );
  });

  it("refunds what was paid, in the same step as the cancel", async () => {
    mockFindFirst.mockResolvedValue(invoice("OVERDUE", [30]));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: true,
      data: { refunded: 30, kept: 0, pointsTakenBack: 10, pointsReturned: 0 },
    });
    expect(mockRecordRefund).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ amount: 30, reason: "Invoice cancelled: service not given", userId: "u1", salonId: "salon_1" })
    );
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "REFUND_CREATED", salonId: "salon_1" }));
    // The refund took its share of the points; the cancel takes back the rest, so none are taken twice.
    expect(mockUndoCancelledSale).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ pointsAlreadyReversed: 3, returnSpentPoints: true })
    );
    // Cancel and refund run in one Serializable transaction, so a payment landing at the same moment aborts one side.
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("doesn't undo the sale twice when the cancel's refund was a full one (it already did)", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    mockRecordRefund.mockResolvedValueOnce({ refundId: "r1", pointsReversed: 10, pointsTaken: 60, pointsReturned: 100, isFullRefund: true });
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: true,
      data: { refunded: 30, kept: 0, pointsTakenBack: 60, pointsReturned: 100 },
    });
    expect(mockUndoCancelledSale).not.toHaveBeenCalled();
  });

  it("shows a refusal from the refund step as-is", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    mockRecordRefund.mockRejectedValueOnce(new RefundRefusal("Refund amount exceeds the $0.00 that can still be refunded"));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: false,
      error: "Refund amount exceeds the $0.00 that can still be refunded",
    });
  });

  it("only counts money not already refunded", async () => {
    mockFindFirst.mockResolvedValue({
      ...invoice("PARTIALLY_PAID", [30], [10]),
      refunds: [{ amount: "10", pointsReversed: 2 }],
    });
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 20 })).toEqual({
      success: true,
      data: { refunded: 20, kept: 0, pointsTakenBack: 10, pointsReturned: 0 },
    });
    expect(mockRecordRefund).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: 20 }));
    // Points the earlier refund took (2) plus this refund's share (3): the cancel only takes the rest.
    expect(mockUndoCancelledSale).toHaveBeenCalledWith(tx, expect.objectContaining({ pointsAlreadyReversed: 5 }));
  });

  it("refuses when the amount paid changed after the person chose (never refunds a figure nobody saw)", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30, 20]));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: false,
      error: CHANGED,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockRecordRefund).not.toHaveBeenCalled();
  });

  it("refuses the refund choice when the refund permission resolves to a different salon", async () => {
    mockCheckAuth.mockImplementation(async (permission: string) =>
      permission === "invoices:refund" ? { ...actor, salonId: "salon_2" } : actor
    );
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: false,
      error: "You don't have permission to refund. Choose Keep, or ask a manager.",
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockRecordRefund).not.toHaveBeenCalled();
  });

  it("counts its own refund for the points it really took, so the rest still comes off afterwards", async () => {
    // The client's balance was too low for the refund's 3-point share: none came off, so the undo
    // step (which first returns any spent points) takes all the bill's earned points.
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    mockRecordRefund.mockResolvedValueOnce({ refundId: "r1", pointsReversed: 3, pointsTaken: 0, pointsReturned: 0, isFullRefund: false });
    await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 });
    expect(mockUndoCancelledSale).toHaveBeenCalledWith(tx, expect.objectContaining({ pointsAlreadyReversed: 0 }));
  });

  it("cancels an unpaid bill even if Refund was sent by someone who can't refund (nothing to give back)", async () => {
    mockCheckAuth.mockImplementation(async (permission: string) => (permission === "invoices:refund" ? null : actor));
    mockFindFirst.mockResolvedValue(invoice("PENDING"));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 0 })).toEqual({
      success: true,
      data: { refunded: 0, kept: 0, pointsTakenBack: 7, pointsReturned: 0 },
    });
  });

  it("refuses the refund choice to someone without the refund permission", async () => {
    mockCheckAuth.mockImplementation(async (permission: string) => (permission === "invoices:refund" ? null : actor));
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    expect(await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 })).toEqual({
      success: false,
      error: "You don't have permission to refund. Choose Keep, or ask a manager.",
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses bills that are paid, already cancelled or refunded", async () => {
    for (const [status, error] of [
      ["PAID", "Cannot cancel a paid invoice"],
      ["CANCELLED", "Invoice is already cancelled"],
      ["REFUNDED", "Cannot cancel a refunded invoice"],
    ]) {
      mockFindFirst.mockResolvedValueOnce(invoice(status));
      expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({ success: false, error });
    }
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("refunds nothing when a payment lands at the same moment and the cancel loses the race", async () => {
    mockFindFirst.mockResolvedValue(invoice("PARTIALLY_PAID", [30]));
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const res = await cancelInvoice({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 });
    expect(res).toEqual({ success: false, error: CHANGED });
    expect(mockRecordRefund).not.toHaveBeenCalled();
    expect(mockUndoCancelledSale).not.toHaveBeenCalled();
  });

  it("turns a same-moment write conflict into a reload message, and hides other database errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindFirst.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" })
    );
    expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({ success: false, error: CHANGED });
    mockFindFirst.mockRejectedValueOnce(new Error("connection to db.internal:5432 refused"));
    expect(await cancelInvoice({ invoiceId: "inv1", expectedPaid: 0 })).toEqual({
      success: false,
      error: "Failed to cancel invoice",
    });
  });
});
