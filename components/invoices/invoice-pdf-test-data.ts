import type { InvoicePDFData } from "./invoice-pdf";

// Shared InvoicePDF fixture for the real-PDF smoke test and the content test.
// A two-line invoice that also used 20 loyalty points: 100 − 10 (discount) − 20 (points) + 7 (tax) = 77.
// The points have no field of their own; the PDF works their value out from the gap in these figures.
export const baseInvoicePdf: InvoicePDFData = {
  invoiceNumber: "INV-000123",
  status: "PAID",
  createdAt: "2026-08-17T04:00:00Z",
  salonName: "Glow Studio",
  salonAddress: "12 Market St",
  salonPhone: "+1 555 0100",
  salonEmail: "hello@glow.test",
  salonLogo: null, // keep images out of the smoke test
  currencyCode: "USD",
  taxRate: 10,
  taxNumber: "GB123456789",
  footerNote: "No refunds after 7 days.",
  timezone: "Asia/Karachi",
  client: { firstName: "Jennifer", lastName: "Smith", email: "j@x.test", phone: "+1 555 0199", isWalkIn: false },
  items: [
    { id: "i1", service: { name: "Package" }, staff: { firstName: "Emma", lastName: "Wilson" }, product: null, price: 90, quantity: 1, discount: 0, note: "VIP" },
    { id: "i2", service: null, staff: null, product: { name: "Serum" }, price: 10, quantity: 1, discount: 0, note: null },
  ],
  subtotal: 100,
  discount: 10,
  tax: 7,
  total: 77,
  amountPaid: 77,
  amountRefunded: 0,
  loyaltyPointsEarned: 15,
};
