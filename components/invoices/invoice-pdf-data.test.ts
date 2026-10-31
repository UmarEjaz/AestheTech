import { describe, it, expect } from "vitest";
import { buildInvoicePdfData, buildPaymentReceipts, type InvoiceForDocuments } from "./invoice-pdf-data";
import type { ReceiptSettings } from "@/components/sales/receipt-data";

const settings: ReceiptSettings = {
  currencyCode: "GBP",
  timezone: "Europe/London",
  salonName: "Glow Studio",
  salonAddress: null,
  salonPhone: "+44 20 0000 0000",
  salonEmail: null,
  salonLogo: null,
  taxRate: 20,
  taxNumber: null,
  receiptFooter: null,
  receiptSize: "THERMAL_58",
};

// Three payments, oldest first, against a £100 invoice; amounts as Decimal-like strings.
const invoice: InvoiceForDocuments = {
  invoiceNumber: "INV-000777",
  status: "PARTIALLY_PAID",
  createdAt: new Date("2026-03-01T10:00:00Z"),
  tax: "16.67",
  total: "100.00",
  client: { firstName: "Sam", lastName: null, email: null, phone: null, isWalkIn: false },
  sale: {
    totalAmount: "83.33",
    discount: "0",
    items: [{ id: "i1", price: "83.33", quantity: 1, discount: "0", note: null, service: { name: "Colour" }, staff: null, product: null }],
  },
  payments: [
    { id: "p1", amount: "25.00", method: "CASH", paidAt: new Date("2026-03-01T10:05:00Z") },
    { id: "p2", amount: "25.00", method: "CARD", paidAt: new Date("2026-03-08T10:05:00Z") },
    { id: "p3", amount: "40.00", method: "CARD", paidAt: new Date("2026-03-15T10:05:00Z") },
  ],
  refunds: [],
};

describe("buildInvoicePdfData", () => {
  it("maps the invoice, sums the payments and prints the given loyalty points", () => {
    const data = buildInvoicePdfData(invoice, settings, { pointsEarned: 5, pointsBalance: 50 });
    expect(data).toMatchObject({
      invoiceNumber: "INV-000777",
      status: "PARTIALLY_PAID",
      createdAt: "2026-03-01T10:00:00.000Z",
      currencyCode: "GBP",
      taxRate: 20,
      timezone: "Europe/London",
      client: { firstName: "Sam", lastName: null, email: null, phone: null, isWalkIn: false },
      subtotal: 83.33,
      discount: 0,
      tax: 16.67,
      total: 100,
      amountPaid: 90,
      amountRefunded: 0,
      loyaltyPointsEarned: 5,
    });
    expect(data.items).toEqual([
      { id: "i1", service: { name: "Colour" }, staff: null, product: null, price: 83.33, quantity: 1, discount: 0, note: null },
    ]);
    expect(buildInvoicePdfData(invoice, settings).loyaltyPointsEarned).toBe(0);
  });
});

describe("buildPaymentReceipts", () => {
  it("gives every payment its own receipt with the balance as it stood at that payment", () => {
    const receipts = buildPaymentReceipts(invoice, settings);
    expect([...receipts.keys()]).toEqual(["p1", "p2", "p3"]);
    expect(receipts.get("p1")).toMatchObject({
      invoiceNumber: "INV-000777",
      paymentDateISO: "2026-03-01T10:05:00.000Z",
      method: "CASH",
      amount: 25,
      invoiceTotal: 100,
      totalPaid: 25,
      size: "THERMAL_58",
      client: { firstName: "Sam", lastName: null, isWalkIn: false },
    });
    expect(receipts.get("p2")?.totalPaid).toBe(50);
    // The salon's tax number and footer note carry through to every payment receipt.
    const withDocs = buildPaymentReceipts(invoice, { ...settings, taxNumber: "GB123", receiptFooter: "Thanks!" });
    expect(withDocs.get("p1")).toMatchObject({ taxNumber: "GB123", footerNote: "Thanks!" });
    expect(receipts.get("p3")?.totalPaid).toBe(90); // still £10 short: that receipt says "Balance Due"
  });

  it("is empty when nothing has been paid", () => {
    expect(buildPaymentReceipts({ ...invoice, payments: [] }, settings).size).toBe(0);
  });
});
