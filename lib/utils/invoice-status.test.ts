import { describe, it, expect } from "vitest";
import { formatInvoiceStatus, invoiceStatusVariant, netPaid, refundableLeft } from "./invoice-status";

describe("formatInvoiceStatus", () => {
  it("turns every stored status into a readable label", () => {
    expect(formatInvoiceStatus("PARTIALLY_PAID")).toBe("Partially Paid");
    expect(formatInvoiceStatus("CANCELLED")).toBe("Cancelled");
  });
});

describe("invoiceStatusVariant", () => {
  it("is green only for paid, amber while money is owed, red overdue, grey for cancelled/refunded", () => {
    expect(invoiceStatusVariant("PAID")).toBe("success");
    // A part-paid bill is still owed money: amber like Pending, never the old "Draft" fallback.
    expect(invoiceStatusVariant("PENDING")).toBe("warning");
    expect(invoiceStatusVariant("PARTIALLY_PAID")).toBe("warning");
    expect(invoiceStatusVariant("OVERDUE")).toBe("destructive");
    expect(invoiceStatusVariant("CANCELLED")).toBe("secondary");
    expect(invoiceStatusVariant("REFUNDED")).toBe("secondary");
  });
});

describe("refundableLeft", () => {
  it("is the total less refunds, not counting change handed back on an overpaid deposit", () => {
    expect(refundableLeft(100, 100, 30)).toBe(70);
    expect(refundableLeft(100, 110, 10)).toBe(100); // the $10 was change, not a refund
    expect(refundableLeft(100, 110, 40)).toBe(70);
    expect(refundableLeft(100, 100, 120)).toBe(0);
  });
});

describe("netPaid", () => {
  it("is paid less refunded, cent-rounded and never below zero", () => {
    expect(netPaid(30, 10)).toBe(20);
    expect(netPaid(0.1 + 0.2, 0)).toBe(0.3); // float drift never makes a cancel look "changed"
    expect(netPaid(10, 15)).toBe(0);
  });
});
