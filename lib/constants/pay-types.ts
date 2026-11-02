import type { PayType as PrismaPayType } from "@prisma/client";

// Browser-safe pay-type constants for the salary form. The TYPE is Prisma's own enum type (type-only
// import, erased at build time); the VALUES are plain strings. `Record<PayType, …>` makes the compiler
// fail if the Prisma enum ever gains or loses a member, so this list can't drift from the schema.
export type PayType = PrismaPayType;

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  MONTHLY: "Monthly",
  HOURLY: "Hourly",
};

/** Every pay type, in display order. */
export const PAY_TYPES = Object.keys(PAY_TYPE_LABELS) as PayType[];

export const DEFAULT_PAY_TYPE: PayType = "MONTHLY";
