import {
  Banknote,
  CreditCard,
  Wallet,
  Receipt,
  Star,
} from "lucide-react";
import { PaymentMethod } from "@prisma/client";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  DIGITAL_WALLET: "Digital Wallet",
  LOYALTY_POINTS: "Loyalty Points",
  OTHER: "Other",
};

const METHOD_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  CARD: CreditCard,
  DIGITAL_WALLET: Wallet,
  LOYALTY_POINTS: Star,
  OTHER: Receipt,
};

/** Payment methods available for selection in checkout (excludes LOYALTY_POINTS, which is handled separately via point redemption). */
export const SELECTABLE_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.DIGITAL_WALLET,
  PaymentMethod.OTHER,
];

export function PaymentMethodIcon({
  method,
  className = "h-4 w-4",
}: {
  method: string;
  className?: string;
}) {
  const Icon = (method in METHOD_ICONS)
    ? METHOD_ICONS[method as PaymentMethod]
    : Receipt;
  return <Icon className={className} />;
}
