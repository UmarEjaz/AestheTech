"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod/dist/zod.js";
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

const refundFormSchema = z.object({
  amount: z.number().min(0.01, "Refund amount must be at least 0.01"),
  reason: z.string().max(500, "Reason must be less than 500 characters").optional(),
});

type RefundFormData = z.infer<typeof refundFormSchema>;

interface RefundDialogProps {
  invoiceId: string;
  invoiceNumber: string;
  maxRefundable: number;
  currencySymbol: string;
}

export function RefundDialog({
  invoiceId,
  invoiceNumber,
  maxRefundable,
  currencySymbol,
}: RefundDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RefundFormData>({
    resolver: zodResolver(refundFormSchema),
    defaultValues: {
      amount: maxRefundable,
      reason: "",
    },
  });

  const currentAmount = watch("amount");
  const isFullRefund = currentAmount >= maxRefundable - 0.01;

  const onSubmit = async (data: RefundFormData) => {
    if (data.amount > maxRefundable) {
      toast.error(`Refund amount cannot exceed ${currencySymbol}${maxRefundable.toFixed(2)}`);
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
        const message = result.data.pointsReversed > 0
          ? `Refund of ${currencySymbol}${data.amount.toFixed(2)} processed. ${result.data.pointsReversed} loyalty points reversed.`
          : `Refund of ${currencySymbol}${data.amount.toFixed(2)} processed successfully.`;
        toast.success(message);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      reset({
        amount: maxRefundable,
        reason: "",
      });
    }
  };

  const handleFullRefund = () => {
    setValue("amount", maxRefundable);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950">
          <RotateCcw className="h-4 w-4 mr-2" />
          Issue Refund
        </Button>
      </DialogTrigger>
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
                Maximum refundable amount: <strong>{currencySymbol}{maxRefundable.toFixed(2)}</strong>
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
                  onClick={handleFullRefund}
                >
                  Full refund
                </Button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {currencySymbol}
                </span>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxRefundable}
                  {...register("amount", { valueAsNumber: true })}
                  className="pl-7"
                  placeholder="0.00"
                />
              </div>
              {errors.amount && (
                <p className="text-sm text-destructive">{errors.amount.message}</p>
              )}
              {isFullRefund && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This will be a full refund and will mark the invoice as refunded.
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
