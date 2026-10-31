import type { ReceiptData } from "./receipt-model";

/** A fully-paid two-line sale whose figures foot exactly; the receipt tests build their cases from it. */
export const baseReceipt: ReceiptData = {
  receiptNumber: "INV-000123",
  dateISO: "2026-08-17T04:00:00Z", // 9:00 AM in Asia/Karachi
  timezone: "Asia/Karachi",
  currencyCode: "USD",
  salonName: "Glow Studio",
  salonAddress: "12 Market St",
  salonPhone: "+1 555 0100",
  salonEmail: "hello@glow.test",
  salonLogo: null,
  client: { firstName: "Jennifer", lastName: "Smith" },
  items: [
    { name: "Beard Trim", staffName: "Emma Wilson", quantity: 1, price: 20, discount: 0 },
    { name: "Shampoo", staffName: null, quantity: 2, price: 5, discount: 2 },
  ],
  subtotal: 30,
  discount: 6, // $2 item discount (Shampoo) + $4 whole-bill; 30 − 6 + 1.35 = 25.35 so the slip foots
  tax: 1.35,
  total: 25.35,
  payments: [{ method: "CARD", amount: 25.35 }],
  amountPaid: 25.35,
  refunded: false,
};
