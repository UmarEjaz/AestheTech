"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, DollarSign, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import { finalizePayrollRun, markPayrollRunPaid, cancelPayrollRun } from "@/lib/actions/payroll";
import { PayrollRunStatus } from "@prisma/client";

interface PayrollRunActionsProps {
  runId: string;
  status: PayrollRunStatus;
  canManage: boolean;
  canPay: boolean;
}

export function PayrollRunActions({ runId, status, canManage, canPay }: PayrollRunActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [createExpenses, setCreateExpenses] = useState(true);

  const handleFinalize = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await finalizePayrollRun(runId);
      if (result.success) {
        toast.success("Payroll run finalized");
        setShowFinalizeDialog(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to finalize payroll run");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePay = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await markPayrollRunPaid(runId, createExpenses);
      if (result.success) {
        toast.success("Payroll run marked as paid");
        setShowPayDialog(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to mark payroll run as paid");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await cancelPayrollRun(runId);
      if (result.success) {
        toast.success("Payroll run cancelled");
        setShowCancelDialog(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to cancel payroll run");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        {status === "DRAFT" && canManage && (
          <>
            <Button onClick={() => setShowFinalizeDialog(true)} disabled={isLoading}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Finalize
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(true)}
              disabled={isLoading}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </>
        )}
        {status === "FINALIZED" && canPay && (
          <>
            <Button onClick={() => setShowPayDialog(true)} disabled={isLoading}>
              <DollarSign className="mr-2 h-4 w-4" />
              Mark as Paid
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(true)}
              disabled={isLoading}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </>
        )}
      </div>

      {/* Finalize Dialog */}
      <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              Once finalized, entries can no longer be edited. You can still cancel the run if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pay Dialog */}
      <AlertDialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Paid?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all entries as paid and record the payment date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center space-x-2 py-4 px-6">
            <Checkbox
              id="createExpenses"
              checked={createExpenses}
              onCheckedChange={(checked) => setCreateExpenses(checked === true)}
            />
            <Label htmlFor="createExpenses" className="text-sm font-normal cursor-pointer">
              Also create salary expenses (records each payment under the &quot;Salaries&quot; expense category)
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePay} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark as Paid
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the payroll run and all its entries. You can delete the cancelled run later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Keep Run</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
