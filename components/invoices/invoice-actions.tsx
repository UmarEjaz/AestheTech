"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, XCircle, RotateCcw, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addPaymentToInvoice, cancelInvoice } from "@/lib/actions/invoice";
import { RefundDialog } from "@/components/sales/refund-dialog";
import { formatCurrency } from "@/lib/utils/currency";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "DIGITAL_WALLET", label: "Digital Wallet" },
  { value: "OTHER", label: "Other" },
] as const;

interface InvoiceActionsProps {
  invoiceId: string;
  invoiceNumber: string;
  /** Effective status (OVERDUE already derived). */
  status: string;
  /** Can manage payments (invoices:update). */
  canUpdate: boolean;
  /** Can cancel the invoice (invoices:delete). */
  canDelete: boolean;
  /** Whether a refund can be issued (paid + refundable + permission). */
  canRefund: boolean;
  maxRefundable: number;
  currencyCode: string;
  /** Remaining balance owed (drives the Add Payment dialog hint + prefill). */
  amountDue: number;
}

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  status,
  canUpdate,
  canDelete,
  canRefund,
  maxRefundable,
  currencyCode,
  amountDue,
}: InvoiceActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("CASH");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  // Status-aware visibility: only show actions valid for the current status.
  // Status itself is never set by hand — it follows recorded payments (Add Payment
  // auto-transitions Pending → Partially Paid → Paid) and Cancel.
  const outstanding = status === "PENDING" || status === "PARTIALLY_PAID" || status === "OVERDUE";
  const showAddPayment = canUpdate && outstanding;
  const showCancel = canDelete && outstanding;
  const showRefund = canRefund;
  const hasOverflow = showRefund || showCancel;

  function addPayment() {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    startTransition(async () => {
      try {
        const res = await addPaymentToInvoice({ invoiceId, amount, method: payMethod as never });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Payment recorded");
        setPayOpen(false);
        setPayAmount("");
        router.refresh();
      } catch (e) {
        console.error("Failed to add payment:", e);
        toast.error("Failed to add payment. Please try again.");
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      try {
        const res = await cancelInvoice(invoiceId);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Invoice cancelled");
        setCancelOpen(false);
        router.refresh();
      } catch (e) {
        console.error("Failed to cancel invoice:", e);
        toast.error("Failed to cancel invoice. Please try again.");
      }
    });
  }

  return (
    <>
      {/* Primary action — paying down a balance (this is also how an invoice
          becomes Paid: record the full balance and it auto-flips to Paid). */}
      {showAddPayment && (
        <Button
          variant="outline"
          onClick={() => { setPayAmount(amountDue > 0 ? amountDue.toFixed(2) : ""); setPayOpen(true); }}
          disabled={isPending}
        >
          <CreditCard className="h-4 w-4 mr-2" />
          Add Payment
        </Button>
      )}

      {/* Secondary actions in an overflow menu */}
      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions" disabled={isPending}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {showRefund && (
              <DropdownMenuItem
                onClick={() => setRefundOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Issue Refund
              </DropdownMenuItem>
            )}
            {showCancel && (
              <>
                {showRefund && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={() => setCancelOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel Invoice
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Add payment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add payment</DialogTitle>
            <DialogDescription>Record a payment against invoice {invoiceNumber}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Balance due</span>
              <span className="font-semibold">{formatCurrency(amountDue, currencyCode)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Paying the full balance marks it <span className="font-medium">Paid</span>; anything less keeps it <span className="font-medium">Partially Paid</span>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={addPayment} disabled={isPending}>{isPending ? "Saving…" : "Add payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invoice {invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the invoice as cancelled. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep invoice</AlertDialogCancel>
            <AlertDialogAction onClick={cancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancel invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund dialog (triggered from the overflow menu) */}
      {showRefund && (
        <RefundDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          maxRefundable={maxRefundable}
          currencyCode={currencyCode}
          open={refundOpen}
          onOpenChange={setRefundOpen}
          hideTrigger
        />
      )}
    </>
  );
}
