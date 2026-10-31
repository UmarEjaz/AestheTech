import {
  Banknote,
  CreditCard,
  Landmark,
  Wallet,
  Receipt,
  Star,
} from "lucide-react";
import type { ReactElement } from "react";
import type { PaymentMethod as PrismaPaymentMethod } from "@prisma/client";

// Browser-safe payment-method constants. The TYPE is Prisma's own enum type (a type-only import is
// erased at build time, so no Prisma runtime code reaches the browser); the VALUES are plain strings.
// `Record<PaymentMethod, …>` below makes the compiler fail if the Prisma enum ever gains or loses a
// member, so this list can't drift from the schema.
export type PaymentMethod = PrismaPaymentMethod;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank Transfer",
  DIGITAL_WALLET: "Digital Wallet",
  LOYALTY_POINTS: "Loyalty Points",
  OTHER: "Other",
};

const METHOD_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  CARD: CreditCard,
  BANK_TRANSFER: Landmark,
  DIGITAL_WALLET: Wallet,
  LOYALTY_POINTS: Star,
  OTHER: Receipt,
};

/** Payment methods available for selection in checkout (excludes LOYALTY_POINTS, which is handled separately via point redemption). */
export const SELECTABLE_PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "DIGITAL_WALLET", "OTHER"];

export function PaymentMethodIcon({
  method,
  className = "h-4 w-4",
}: {
  method: string;
  className?: string;
}): ReactElement {
  const Icon = (method in METHOD_ICONS)
    ? METHOD_ICONS[method as PaymentMethod]
    : Receipt;
  return <Icon className={className} />;
}
