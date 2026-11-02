import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

// ---- Fakes for the server action's dependencies (no real DB / auth / redis) ----
const mockCheckAuth = vi.fn();
const mockFindFirst = vi.fn();
const mockInvoiceUpdate = vi.fn();
const mockRecordRefund = vi.fn();
const mockLogAudit = vi.fn();
const tx = { invoice: { findFirst: mockFindFirst, update: mockInvoiceUpdate } };

vi.mock("@/lib/auth-helpers", () => ({ checkAuth: (...a: unknown[]) => mockCheckAuth(...a) }));
vi.mock("./audit", () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));
vi.mock("@/lib/redis", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/payment-guards", () => ({ assertPaymentOwner: vi.fn() }));
vi.mock("@/lib/invoice-overdue", () => ({ salonOverdueCutoff: vi.fn() }));
vi.mock("@/lib/refund-core", () => ({
  refundInvoiceInclude: {},
  RefundRefusal: class RefundRefusal extends Error {},
  INVOICE_CHANGED: "This invoice just changed. Please reload and try again.",
  refundSettings: vi.fn(async () => ({ thresholds: { goldThreshold: 500, platinumThreshold: 1000 }, currencyCode: "USD" })),
  recordRefund: (...a: unknown[]) => mockRecordRefund(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

import { createRefund } from "./invoice";
import { RefundRefusal } from "@/lib/refund-core";

const actor = { userId: "u1", salonId: "salon_1", role: "OWNER" };
const paidInvoice = { id: "inv1", status: "PAID", saleId: "sale1", sale: { clientId: "c1" } };
const input = { invoiceId: "inv1", amount: 20 };

afterEach((): void => {
  vi.restoreAllMocks(); // undo the console.error silencing spies
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockCheckAuth.mockResolvedValue(actor);
  mockFindFirst.mockResolvedValue(paidInvoice);
  mockRecordRefund.mockResolvedValue({ refundId: "r1", pointsReversed: 2, pointsTaken: 1, pointsReturned: 0, isFullRefund: false });
});

describe("createRefund", () => {
  it("records the refund for the signed-in salon and logs it against that salon", async () => {
    // The toast uses pointsTaken: what really came off the balance (here the client had only 1 left).
    expect(await createRefund(input)).toEqual({ success: true, data: { refundId: "r1", pointsReversed: 2, pointsTaken: 1, pointsReturned: 0 } });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv1", salonId: "salon_1" } }));
    expect(mockInvoiceUpdate).not.toHaveBeenCalled(); // a part refund leaves the invoice PAID
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "REFUND_CREATED", salonId: "salon_1" }));
  });

  it("marks the invoice REFUNDED once the refunds cover the whole total", async () => {
    mockRecordRefund.mockResolvedValue({ refundId: "r1", pointsReversed: 10, pointsTaken: 10, pointsReturned: 0, isFullRefund: true });
    await createRefund(input);
    expect(mockInvoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { status: "REFUNDED", refundedAt: expect.any(Date) },
    });
  });

  it("shows a refusal the person can act on as-is", async () => {
    mockFindFirst.mockResolvedValueOnce({ ...paidInvoice, status: "PENDING" });
    expect(await createRefund(input)).toEqual({ success: false, error: "Only paid invoices can be refunded" });
    mockRecordRefund.mockRejectedValueOnce(new RefundRefusal("Refund amount exceeds the $5.00 that can still be refunded"));
    expect(await createRefund(input)).toEqual({
      success: false,
      error: "Refund amount exceeds the $5.00 that can still be refunded",
    });
  });

  it("turns a same-moment write conflict into a reload message, and hides other database errors", async () => {
    mockFindFirst.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" })
    );
    expect(await createRefund(input)).toEqual({
      success: false,
      error: "This invoice just changed. Please reload and try again.",
    });
    mockFindFirst.mockRejectedValueOnce(new Error("connection to db.internal:5432 refused"));
    expect(await createRefund(input)).toEqual({ success: false, error: "Failed to create refund" });
  });

  it("refuses without the refund permission", async () => {
    mockCheckAuth.mockResolvedValueOnce(null);
    expect(await createRefund(input)).toEqual({ success: false, error: "Unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
