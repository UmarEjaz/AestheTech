"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelInvoice, type CancelInvoiceResult } from "@/lib/actions/invoice-cancel";
import { paidMoneyChoiceSchema, type PaidMoneyChoice } from "@/lib/validations/invoice-cancel";
import { formatCurrency } from "@/lib/utils/currency";
import { pointsLabel } from "@/lib/utils/points-label";

interface CancelInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  currencyCode: string;
  /** Money already paid on this bill (payments less any refunds). */
  paidAmount: number;
  /** Can give money back (invoices:refund). Without it, the paid money can only be kept. */
  canRefundMoney: boolean;
}

/** The success message, naming what happened to any money already paid and to the client's points. */
export function cancelToast(
  invoiceNumber: string,
  clientName: string,
  result: CancelInvoiceResult,
  currencyCode: string
): string {
  const money = (n: number): string => formatCurrency(n, currencyCode);
  const parts = [`Invoice ${invoiceNumber} cancelled.`];
  if (result.refunded > 0) parts.push(`${money(result.refunded)} refunded to ${clientName}.`);
  else if (result.kept > 0) parts.push(`${money(result.kept)} kept as a cancellation fee.`);
  if (result.pointsTakenBack > 0) parts.push(`${pointsLabel(result.pointsTakenBack)} taken back.`);
  if (result.pointsReturned > 0) parts.push(`${pointsLabel(result.pointsReturned)} spent on it returned to ${clientName}.`);
  return parts.join(" ");
}

/**
 * Confirm cancelling a bill. When money has already been paid, staff choose right here whether to
 * refund it or keep it, so it is never left stuck on a cancelled bill.
 */
export function CancelInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  clientName,
  currencyCode,
  paidAmount,
  canRefundMoney,
}: CancelInvoiceDialogProps): ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Keep is the only choice for someone who can't refund, so it starts selected for them.
  const initialChoice: PaidMoneyChoice | null = canRefundMoney ? null : "KEEP";
  const [choice, setChoice] = useState<PaidMoneyChoice | null>(initialChoice);
  const hasPaidMoney = paidAmount > 0;
  const paid = formatCurrency(paidAmount, currencyCode);

  function close(): void {
    setChoice(initialChoice);
    onOpenChange(false);
  }

  // Closing (Escape, the X) is blocked while the cancel is saving.
  function handleOpenChange(next: boolean): void {
    if (next) onOpenChange(true);
    else if (!isPending) close();
  }

  function cancel(): void {
    startTransition(async () => {
      try {
        const res = await cancelInvoice({
          invoiceId,
          paidMoney: hasPaidMoney ? choice ?? undefined : undefined,
          expectedPaid: paidAmount,
        });
        if (!res.success) {
          toast.error(res.error);
          // E.g. a payment landed meanwhile: show the live amount and make them choose again for it.
          setChoice(initialChoice);
          router.refresh();
          return;
        }
        toast.success(cancelToast(invoiceNumber, clientName, res.data, currencyCode));
        close();
        router.refresh();
      } catch (e) {
        console.error("Failed to cancel invoice:", e);
        toast.error("Failed to cancel invoice. Please try again.");
        // The cancel may have gone through before the connection dropped: show the live state.
        setChoice(initialChoice);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* A destructive confirmation: announced as an alert dialog, and not closed by a stray click outside. */}
      <DialogContent role="alertdialog" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Cancel invoice {invoiceNumber}?</DialogTitle>
          <DialogDescription>
            {!hasPaidMoney
              ? "This marks the invoice as cancelled. This can't be undone."
              : canRefundMoney
                ? `${paid} has been paid on this bill. Choose what happens to it. This can't be undone.`
                : `${paid} has been paid on this bill and will be kept as a cancellation fee. This can't be undone.`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Loyalty points this bill earned (birthday bonus included) are taken back, and its products go back
          into stock.{hasPaidMoney ? "" : " Any points spent on it go back to the client."}
        </p>

        {hasPaidMoney && (
          <RadioGroup
            value={choice ?? ""}
            onValueChange={(v) => {
              const picked = paidMoneyChoiceSchema.safeParse(v);
              if (picked.success) setChoice(picked.data);
            }}
            aria-label={`What happens to the ${paid} already paid`}
            className="space-y-2"
          >
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="REFUND" id="cancel-refund" className="mt-0.5" disabled={!canRefundMoney} />
              <div className="flex-1">
                <Label
                  htmlFor="cancel-refund"
                  className={canRefundMoney ? "cursor-pointer font-medium" : "cursor-not-allowed font-medium opacity-60"}
                >
                  Refund {paid} to {clientName}
                </Label>
                {/* Kept outside the dimmed label so the reason stays readable. */}
                <p className="text-sm text-muted-foreground">
                  {canRefundMoney
                    ? "The service wasn't given. Points spent on it go back too."
                    : "You don't have permission to refund. Ask a manager."}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="KEEP" id="cancel-keep" className="mt-0.5" />
              <Label htmlFor="cancel-keep" className="flex-1 cursor-pointer">
                <span className="font-medium">Keep {paid}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  As a cancellation or no-show fee. Points spent on it stay spent.
                </span>
              </Label>
            </div>
          </RadioGroup>
        )}

        {hasPaidMoney && !choice && (
          <p id="cancel-choice-hint" className="text-sm text-muted-foreground">
            Choose Refund or Keep to continue.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>
            Don&apos;t cancel
          </Button>
          <Button
            variant="destructive"
            onClick={cancel}
            disabled={isPending || (hasPaidMoney && !choice)}
            aria-describedby={hasPaidMoney && !choice ? "cancel-choice-hint" : undefined}
          >
            {isPending ? "Cancelling…" : "Cancel invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
