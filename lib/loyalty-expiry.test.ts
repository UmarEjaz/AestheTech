import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- Fakes for the module's dependencies (no real DB) ----
const settingsFind = vi.fn();
const dueGroupBy = vi.fn();
const transaction = vi.fn();
const lockedPoints = vi.fn();
const rowsFind = vi.fn();
const txnUpdateMany = vi.fn();
const txnCreateMany = vi.fn();
const pointsUpdate = vi.fn();
const invoiceFind = vi.fn();
const tx = {
  $executeRaw: vi.fn(), // the salon lock
  $queryRaw: vi.fn(() => lockedPoints()), // the clients' balances, locked FOR UPDATE
  loyaltyTransaction: { findMany: rowsFind, updateMany: txnUpdateMany, createMany: txnCreateMany },
  loyaltyPoints: { update: pointsUpdate },
  invoice: { findMany: invoiceFind },
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    settings: { findMany: (...a: unknown[]) => settingsFind(...a) },
    loyaltyTransaction: { groupBy: (...a: unknown[]) => dueGroupBy(...a) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => transaction(fn, opts),
  },
}));

import { expirePoints } from "./loyalty-expiry";

const row = (id: string, points: number, type: string, saleId: string | null = null, clientId = "c1"): Record<string, unknown> => ({
  id,
  clientId,
  points,
  type,
  saleId,
});
const sql = (call: unknown[]): string => (call[0] as TemplateStringsArray).join("?");

afterEach((): void => {
  vi.restoreAllMocks(); // undo the console.error silencing spy, even when a test fails early
});

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  settingsFind.mockResolvedValue([{ salonId: "salon_1", goldThreshold: 500, platinumThreshold: 1000 }]);
  dueGroupBy.mockResolvedValue([{ clientId: "c1" }]);
  lockedPoints.mockResolvedValue([{ clientId: "c1", salonId: "salon_1", balance: 100 }]);
  rowsFind.mockResolvedValue([]);
  invoiceFind.mockResolvedValue([]);
});

describe("expirePoints", () => {
  it("expires only what a part refund left of a sale's earned points, and stamps the rows expired", async () => {
    // 50 earned on a sale, 20 of them already taken back by a part refund; plus a 10-point bonus.
    rowsFind.mockResolvedValue([row("t1", 50, "EARNED", "sale1"), row("t2", 10, "BONUS", "sale1")]);
    invoiceFind.mockResolvedValue([{ saleId: "sale1", refunds: [{ pointsReversed: 20 }] }]);
    expect(await expirePoints(null)).toEqual({ clientsAffected: 1, totalPointsExpired: 40 });
    expect(invoiceFind).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon_1", saleId: { in: ["sale1"] } } }));
    expect(pointsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balance: 60 }) }));
    expect(txnCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ clientId: "c1", points: -40, type: "EXPIRED", salonId: "salon_1" })],
    });
    expect(txnUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] } },
      data: { expiresAt: null, expiredAt: expect.any(Date) },
    });
  });

  it("finds due clients by grouping (only their ids are read), a batch at a time", async () => {
    await expirePoints(null);
    expect(dueGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["clientId"], orderBy: { clientId: "asc" }, take: 100 })
    );
  });

  it("locks the batch's balances before reading them, under its own lock, in a short transaction", async () => {
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS")]);
    await expirePoints(null);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    expect(sql(tx.$executeRaw.mock.calls[0])).toContain("pg_advisory_xact_lock(hashtext(?), hashtext(?))");
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(["loyalty-expiry", "salon_1"]);
    expect(sql(tx.$queryRaw.mock.calls[0])).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(rowsFind.mock.invocationCallOrder[0]);
  });

  it("handles a whole batch of clients with bulk reads and writes", async () => {
    dueGroupBy.mockResolvedValue([{ clientId: "c1" }, { clientId: "c2" }]);
    lockedPoints.mockResolvedValue([
      { clientId: "c1", salonId: "salon_1", balance: 100 },
      { clientId: "c2", salonId: "salon_1", balance: 5 },
    ]);
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS"), row("t2", 10, "BONUS", null, "c2")]);
    expect(await expirePoints(null)).toEqual({ clientsAffected: 2, totalPointsExpired: 15 }); // c2 only had 5
    expect(rowsFind).toHaveBeenCalledOnce();
    expect(txnCreateMany).toHaveBeenCalledOnce();
    expect(txnUpdateMany).toHaveBeenCalledOnce();
  });

  it("covers every salon that has expiry on, each by its own thresholds", async () => {
    settingsFind.mockResolvedValue([
      { salonId: "salon_1", goldThreshold: 500, platinumThreshold: 1000 },
      { salonId: "salon_2", goldThreshold: 50, platinumThreshold: 80 },
    ]);
    dueGroupBy.mockImplementation(async (args: { where: { salonId: string } }) =>
      args.where.salonId === "salon_2" ? [{ clientId: "c2" }] : []
    );
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS", null, "c2")]);
    lockedPoints.mockResolvedValue([{ clientId: "c2", salonId: "salon_2", balance: 100 }]);
    await expirePoints(null);
    expect(settingsFind).toHaveBeenCalledWith(expect.objectContaining({ where: { pointsExpiryEnabled: true } }));
    expect(dueGroupBy).toHaveBeenCalledTimes(2); // one lookup per salon
    // 90 points is Platinum by salon 2's own thresholds.
    expect(pointsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { balance: 90, tier: "PLATINUM" } }));
  });

  it("keeps going when one salon fails, then reports the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    settingsFind.mockResolvedValue([
      { salonId: "salon_1", goldThreshold: 500, platinumThreshold: 1000 },
      { salonId: "salon_2", goldThreshold: 500, platinumThreshold: 1000 },
    ]);
    dueGroupBy.mockImplementation(async (args: { where: { salonId: string } }) => {
      if (args.where.salonId === "salon_1") throw new Error("transaction timed out");
      return [{ clientId: "c1" }];
    });
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS")]);
    await expect(expirePoints(null)).rejects.toThrow("Points expiry failed for 1 salon(s)");
    expect(txnUpdateMany).toHaveBeenCalledOnce(); // salon 2 still ran
  });

  it("works through a full batch and then looks for more", async () => {
    dueGroupBy
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ clientId: `c${i}` })))
      .mockResolvedValueOnce([]);
    await expirePoints(null);
    expect(dueGroupBy).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("covers only the given salon when one is named", async () => {
    await expirePoints("salon_1");
    expect(settingsFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pointsExpiryEnabled: true, salonId: "salon_1" } })
    );
  });

  it("takes nothing off a client already at zero, but still marks their rows handled", async () => {
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS")]);
    lockedPoints.mockResolvedValue([{ clientId: "c1", salonId: "salon_1", balance: 0 }]);
    expect(await expirePoints(null)).toEqual({ clientsAffected: 0, totalPointsExpired: 0 });
    expect(pointsUpdate).not.toHaveBeenCalled();
    expect(txnCreateMany).not.toHaveBeenCalled();
    expect(txnUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["t1"] } }, data: { expiresAt: null, expiredAt: expect.any(Date) } });
  });

  it("marks the rows of a client with no points record handled too, so they aren't picked up again", async () => {
    rowsFind.mockResolvedValue([row("t1", 10, "BONUS")]);
    lockedPoints.mockResolvedValue([]);
    expect(await expirePoints(null)).toEqual({ clientsAffected: 0, totalPointsExpired: 0 });
    expect(txnUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["t1"] } }, data: { expiresAt: null, expiredAt: expect.any(Date) } });
  });

  it("skips clients whose rows another run already handled", async () => {
    await expirePoints(null);
    expect(txnUpdateMany).not.toHaveBeenCalled();
  });

  it("does nothing when no salon has points expiry turned on", async () => {
    settingsFind.mockResolvedValue([]);
    expect(await expirePoints(null)).toEqual({ clientsAffected: 0, totalPointsExpired: 0 });
    expect(dueGroupBy).not.toHaveBeenCalled();
  });
});
