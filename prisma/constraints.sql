-- Database-level rules that Prisma's schema language can't express, so they live here and
-- must be re-applied after every `prisma db push` (see the "db:push" npm script, which chains
-- this file automatically). Every statement is idempotent — safe to run repeatedly.

-- A payment must belong to an invoice and/or an appointment. Prevents orphaned payment rows
-- (money that references nothing). Enforced in app code too (lib/payment-guards.ts).
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payment_owner_required";
ALTER TABLE "payments" ADD CONSTRAINT "payment_owner_required"
  CHECK ("invoiceId" IS NOT NULL OR "appointmentId" IS NOT NULL);
