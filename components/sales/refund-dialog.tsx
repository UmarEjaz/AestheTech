"use client";

import { useState, useMemo, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { createRefund } from "@/lib/actions/invoice";
import { formatCurrency, getCurrencyDecimals } from "@/lib/utils/currency";
import { getCurrencySymbol } from "@/lib/currencies";
import { pointsLabel } from "@/lib/utils/points-label";

function getMinAmount(currencyCode: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  return decimals === 0 ? 1 : Number(Math.pow(10, -decimals).toFixed(decimals));
}

function createRefundSchema(
  currencyCode: string
): z.ZodObject<{ amount: z.ZodNumber; reason: z.ZodOptional<z.ZodString> }> {
  const minAmount = getMinAmount(currencyCode);
  const decimals = getCurrencyDecimals(currencyCode);
  return z.object({
    amount: z
      .number()
      .min(minAmount, `Refund amount must be at least ${minAmount}`)
      .refine(
        (val) => {
          const shifted = val * Math.pow(10, decimals);
          return Math.abs(shifted - Math.round(shifted)) < 1e-9;
        },
        `Amount cannot have more than ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
      ),
    reason: z.string().max(500, "Reason must be less than 500 characters").optional(),
  });
}

interface RefundDialogProps {
  invoiceId: string;
  invoiceNumber: string;
  maxRefundable: number;
  currencyCode: string;
  /** Named in the success message, e.g. "Refund of $20.00 processed for Jennifer Smith." */
  clientName: string;
  /** Controlled open state (used when the trigger lives elsewhere, e.g. a menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (when controlled externally). */
  hideTrigger?: boolean;
}

export function RefundDialog({
  invoiceId,
  invoiceNumber,
  maxRefundable,
  currencyCode,
  clientName,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: RefundDialogProps): ReactElement {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refundSchema = useMemo(() => createRefundSchema(currencyCode), [currencyCode]);
  type RefundFormData = z.infer<typeof refundSchema>;
  const minAmount = getMinAmount(currencyCode);
  const decimals = getCurrencyDecimals(currencyCode);
  const stepValue = minAmount.toString();
  const placeholder = decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`;
  const symbol = getCurrencySymbol(currencyCode);
  const inputPadding = symbol.length >= 3 ? "pl-12" : "pl-7";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RefundFormData>({
    resolver: zodResolver(refundSchema),
    defaultValues: {
      amount: maxRefundable,
      reason: "",
    },
  });

  const currentAmount = watch("amount") || 0;
  const isFullRefund = currentAmount > maxRefundable - minAmount;

  const onSubmit = async (data: RefundFormData): Promise<void> => {
    if (data.amount > maxRefundable) {
      toast.error(`Refund amount cannot exceed ${formatCurrency(maxRefundable, currencyCode)}`);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createRefund({
        invoiceId,
        amount: data.amount,
        reason: data.reason || undefined,
      });

      if (result.success) {
        // The points that actually came off (and came back), matching the client's points history.
        const parts = [`Refund of ${formatCurrency(data.amount, currencyCode)} processed for ${clientName}.`];
        if (result.data.pointsTaken > 0) parts.push(`${pointsLabel(result.data.pointsTaken)} taken back.`);
        if (result.data.pointsReturned > 0) parts.push(`${pointsLabel(result.data.pointsReturned)} spent on it returned to ${clientName}.`);
        toast.success(parts.join(" "));
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean): void => {
    setOpen(newOpen);
    if (!newOpen) reset({ amount: maxRefundable, reason: "" });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950">
            <RotateCcw className="h-4 w-4 mr-2" />
            Issue Refund
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Refund</DialogTitle>
          <DialogDescription>
            Process a refund for invoice {invoiceNumber}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <Alert>
              <AlertDescription>
                Maximum refundable amount: <strong>{formatCurrency(maxRefundable, currencyCode)}</strong>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Refund Amount</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setValue("amount", maxRefundable)}
                >
                  Full refund
                </Button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="amount"
                  type="number"
                  step={stepValue}
                  min={stepValue}
                  max={maxRefundable}
                  {...register("amount", { valueAsNumber: true })}
                  className={inputPadding}
                  placeholder={placeholder}
                />
              </div>
              {errors.amount && (
                <p className="text-sm text-destructive">{errors.amount.message}</p>
              )}
              {isFullRefund && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This will be a full refund and will mark the invoice as refunded. Points it earned come off the client; any points they spent on it go back.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason (Optional)</Label>
              <Textarea
                id="reason"
                {...register("reason")}
                placeholder="Enter reason for refund..."
                rows={3}
              />
              {errors.reason && (
                <p className="text-sm text-destructive">{errors.reason.message}</p>
              )}
            </div>

            <Alert variant="destructive" className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
              <AlertDescription className="text-red-800 dark:text-red-200">
                Issuing a refund will also reverse any loyalty points earned from this sale proportionally.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Process Refund
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
