-- Database-level rules that Prisma's schema language can't express, so they live here and
-- must be re-applied after every `prisma db push` (see the "db:push" npm script, which chains
-- this file automatically). Every statement is idempotent — safe to run repeatedly.

-- A payment must belong to an invoice and/or an appointment. Prevents orphaned payment rows
-- (money that references nothing). Enforced in app code too (lib/payment-guards.ts).
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payment_owner_required";
ALTER TABLE "payments" ADD CONSTRAINT "payment_owner_required"
  CHECK ("invoiceId" IS NOT NULL OR "appointmentId" IS NOT NULL);

-- No provider may be booked for two overlapping time slices. This is the storage-level backstop
-- against double-booking (the app also pre-checks for a friendly message). btree_gist lets a GiST
-- exclusion constraint combine equality on staffId with range-overlap on the busy window.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Note: no data backfill here. The app writes segmentStart/segmentEnd/active on every booking, and
-- the seed sets them on its sample appointments, so all rows already carry their busy window.
-- DEFERRABLE INITIALLY DEFERRED: the rule is checked once at COMMIT, not after every row. That lets
-- a multi-row update (e.g. rescheduling a multi-service block for the same provider) pass through
-- transient overlapping states while still guaranteeing the final committed state has no overlaps.
ALTER TABLE "appointment_services" DROP CONSTRAINT IF EXISTS "no_provider_overlap";
ALTER TABLE "appointment_services" ADD CONSTRAINT "no_provider_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("segmentStart", "segmentEnd", '[)') WITH &&
  )
  WHERE ("active" AND "segmentStart" IS NOT NULL AND "segmentEnd" IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;
