import { describe, it, expect } from "vitest";
import { invoiceEmailHtml, receiptEmailHtml } from "./email-templates";

const data = {
  salonName: "Glow Studio",
  clientName: "Jennifer",
  invoiceNumber: "INV-000123",
  date: "March 1, 2026",
  items: [{ name: "Colour", price: 100, quantity: 1 }],
  subtotal: 100,
  discount: 0,
  tax: 0,
  total: 100,
  currencyCode: "USD",
  paymentMethods: ["Cash"],
};

describe("receiptEmailHtml", () => {
  it("thanks the client on a normal receipt", () => {
    expect(receiptEmailHtml(data)).toContain("Thank you for your visit!");
  });

  it("says the bill was cancelled, and what became of the money, instead of the thank-you", () => {
    const html = receiptEmailHtml({ ...data, statusNote: "This bill was cancelled. $30.00 refunded." });
    expect(html).toContain("This bill was cancelled. $30.00 refunded.");
    expect(html).not.toContain("Thank you for your visit!");
  });
});

describe("invoiceEmailHtml", () => {
  const invoice = { ...data, clientEmail: "j@x.test", status: "CANCELLED" };
  it("says the invoice was cancelled, and what became of the money, instead of the usual intro", () => {
    const html = invoiceEmailHtml({ ...invoice, statusNote: "This invoice was cancelled. $30.00 refunded." });
    expect(html).toContain("This invoice was cancelled. $30.00 refunded.");
    expect(html).not.toContain("Please find your invoice details below.");
    expect(invoiceEmailHtml({ ...invoice, status: "PENDING" })).toContain("Please find your invoice details below.");
  });
});
