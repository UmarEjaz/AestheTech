import {
  Banknote,
  CreditCard,
  Wallet,
  Receipt,
} from "lucide-react";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  DIGITAL_WALLET: "Digital Wallet",
  LOYALTY_POINTS: "Loyalty Points",
  OTHER: "Other",
};

const METHOD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  CARD: CreditCard,
  DIGITAL_WALLET: Wallet,
  LOYALTY_POINTS: Receipt,
  OTHER: Receipt,
};

export function PaymentMethodIcon({
  method,
  className = "h-4 w-4",
}: {
  method: string;
  className?: string;
}) {
  const Icon = METHOD_ICONS[method] ?? Receipt;
  return <Icon className={className} />;
}
