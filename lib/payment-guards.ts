/**
 * A Payment must always belong to an invoice (a checkout payment) and/or an appointment
 * (a deposit taken before any invoice exists). This guard rejects an ownerless payment in
 * application code with a clear message; the database also enforces it as a hard backstop
 * (the `payment_owner_required` CHECK constraint — see prisma/constraints.sql).
 */
export function assertPaymentOwner(data: {
  invoiceId?: string | null;
  appointmentId?: string | null;
}): void {
  if (!data.invoiceId && !data.appointmentId) {
    throw new Error("A payment must reference an invoice or an appointment.");
  }
}
