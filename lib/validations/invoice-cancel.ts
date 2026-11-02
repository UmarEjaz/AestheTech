import { z } from "zod";

/**
 * What happens to money already paid when a bill is cancelled: give it back (the service wasn't given)
 * or keep it (e.g. a no-show or late-cancellation fee). Browser-safe, so the cancel dialog shares it.
 */
export const paidMoneyChoiceSchema = z.enum(["REFUND", "KEEP"]);
export type PaidMoneyChoice = z.infer<typeof paidMoneyChoiceSchema>;

export const cancelInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  paidMoney: paidMoneyChoiceSchema.optional(),
  // The money-already-paid figure the person saw when choosing. If it has changed since (a payment
  // landed meanwhile), the cancel is refused rather than refunding or keeping an amount nobody agreed to.
  expectedPaid: z.number().finite().nonnegative(),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;
