import { describe, it, expect } from "vitest";
import {
  buildSaleInvoicePdfData,
  buildSaleReceiptData,
  sumAmounts,
  type InvoiceSale,
  type ReceiptSettings,
} from "./receipt-data";

// Amounts are given as numeric strings, the way Prisma Decimals arrive, to prove the builders convert.
const settings: ReceiptSettings = {
  currencyCode: "USD",
  timezone: "Asia/Karachi",
  salonName: "Glow Studio",
  salonAddress: "12 Market St",
  salonPhone: "+1 555 0100",
  salonEmail: "hello@glow.test",
  salonLogo: null,
  taxRate: 5,
  taxNumber: "GB123",
  receiptFooter: "No refunds after 7 days.",
  receiptSize: "A5",
};

const sale: InvoiceSale = {
  createdAt: new Date("2026-08-17T04:00:00Z"),
  totalAmount: "30.00",
  discount: "6.00",
  client: { firstName: "Jennifer", lastName: "Smith", email: "j@x.test", phone: null, isWalkIn: false },
  items: [
    { id: "i1", price: "20.00", quantity: 1, discount: "0", note: null, service: { name: "Beard Trim" }, staff: { firstName: "Emma", lastName: "Wilson" }, product: null },
    { id: "i2", price: "5.00", quantity: 2, discount: "2.00", note: "gift", service: null, staff: null, product: { name: "Shampoo" } },
  ],
  invoice: {
    invoiceNumber: "INV-000123",
    status: "PAID",
    tax: "1.35",
    total: "25.35",
    payments: [{ amount: "10.00" }, { amount: "15.35" }],
    refunds: [{ amount: "5.00" }],
  },
};

// The receipt needs the payment method and the refund timestamp on top.
const receiptSale = {
  ...sale,
  client: { firstName: "Jennifer", lastName: "Smith", isWalkIn: false },
  invoice: {
    ...sale.invoice!,
    refundedAt: null,
    payments: [
      { method: "CASH", amount: "10.00" },
      { method: "CARD", amount: "15.35" },
    ],
  },
};

describe("sumAmounts", () => {
  it("adds Decimal-like strings and numbers", () => {
    // The object case stands in for a Prisma Decimal (Number() reads it through valueOf/toString).
    const decimalLike = { toFixed: (): string => "1", toString: (): string => "1" };
    expect(sumAmounts([{ amount: "10.50" }, { amount: 4.5 }, { amount: decimalLike }])).toBe(16);
    expect(sumAmounts([])).toBe(0);
  });
});

describe("buildSaleReceiptData", () => {
  it("is null before the sale has an invoice", () => {
    expect(buildSaleReceiptData({ ...receiptSale, invoice: null }, settings)).toBeNull();
  });

  it("maps the sale, salon settings and loyalty figures onto the flat receipt shape", () => {
    const data = buildSaleReceiptData(receiptSale, settings, { pointsEarned: 12, pointsBalance: 300 });
    expect(data).toMatchObject({
      receiptNumber: "INV-000123",
      dateISO: "2026-08-17T04:00:00.000Z",
      timezone: "Asia/Karachi",
      currencyCode: "USD",
      salonName: "Glow Studio",
      taxNumber: "GB123",
      footerNote: "No refunds after 7 days.",
      client: { firstName: "Jennifer", lastName: "Smith", isWalkIn: false },
      subtotal: 30,
      discount: 6,
      tax: 1.35,
      total: 25.35,
      amountPaid: 25.35,
      amountRefunded: 5,
      refunded: false,
      pointsEarned: 12,
      pointsBalance: 300,
      size: "A5",
    });
    expect(data?.items).toEqual([
      { name: "Beard Trim", staffName: "Emma Wilson", quantity: 1, price: 20, discount: 0 },
      { name: "Shampoo", staffName: null, quantity: 2, price: 5, discount: 2 },
    ]);
    expect(data?.payments).toEqual([
      { method: "CASH", amount: 10 },
      { method: "CARD", amount: 15.35 },
    ]);
  });

  it("defaults to no loyalty figures and flags a refunded invoice by status or timestamp", () => {
    const plain = buildSaleReceiptData(receiptSale, settings);
    expect(plain).toMatchObject({ pointsEarned: 0, pointsBalance: null, refunded: false });
    const byStatus = buildSaleReceiptData({ ...receiptSale, invoice: { ...receiptSale.invoice, status: "REFUNDED" } }, settings);
    expect(byStatus?.refunded).toBe(true);
    const byTimestamp = buildSaleReceiptData(
      { ...receiptSale, invoice: { ...receiptSale.invoice, refundedAt: new Date("2026-08-18T00:00:00Z") } },
      settings
    );
    expect(byTimestamp?.refunded).toBe(true);
  });
});

describe("buildSaleInvoicePdfData", () => {
  it("is null before the sale has an invoice", () => {
    expect(buildSaleInvoicePdfData({ ...sale, invoice: null }, settings)).toBeNull();
  });

  it("maps the sale onto the invoice PDF shape, summing payments and refunds", () => {
    const data = buildSaleInvoicePdfData(sale, settings);
    expect(data).toMatchObject({
      invoiceNumber: "INV-000123",
      status: "PAID",
      createdAt: "2026-08-17T04:00:00.000Z",
      taxRate: 5,
      taxNumber: "GB123",
      footerNote: "No refunds after 7 days.",
      client: { firstName: "Jennifer", lastName: "Smith", email: "j@x.test", phone: null, isWalkIn: false },
      subtotal: 30,
      discount: 6,
      tax: 1.35,
      total: 25.35,
      amountPaid: 25.35,
      amountRefunded: 5,
      loyaltyPointsEarned: 0,
    });
    expect(data?.items[1]).toEqual({
      id: "i2",
      service: null,
      staff: null,
      product: { name: "Shampoo" },
      price: 5,
      quantity: 2,
      discount: 2,
      note: "gift",
    });
  });

  it("prints the derived status and the loyalty points when given", () => {
    const data = buildSaleInvoicePdfData(sale, settings, {
      status: "OVERDUE",
      loyalty: { pointsEarned: 7, pointsBalance: 99 },
    });
    expect(data?.status).toBe("OVERDUE");
    expect(data?.loyaltyPointsEarned).toBe(7);
  });
});
