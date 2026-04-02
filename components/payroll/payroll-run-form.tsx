"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createPayrollRunSchema, CreatePayrollRunInput } from "@/lib/validations/payroll";
import { createPayrollRun, previewPayrollRun, PayrollPreview } from "@/lib/actions/payroll";

type PayrollRunFormInput = {
  periodStart: Date | string;
  periodEnd: Date | string;
  notes?: string;
};

export function PayrollRunForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [pendingData, setPendingData] = useState<CreatePayrollRunInput | null>(null);

  // Default to current month (use local date parts to avoid UTC timezone shift)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultStart = `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-${pad(monthStart.getDate())}`;
  const defaultEnd = `${monthEnd.getFullYear()}-${pad(monthEnd.getMonth() + 1)}-${pad(monthEnd.getDate())}`;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<PayrollRunFormInput, unknown, CreatePayrollRunInput>({
    resolver: zodResolver(createPayrollRunSchema) as any,
    defaultValues: {
      periodStart: new Date(defaultStart + "T00:00:00"),
      periodEnd: new Date(defaultEnd + "T00:00:00"),
      notes: "",
    },
  });

  const onSubmit = async (data: CreatePayrollRunInput) => {
    setIsSubmitting(true);

    try {
      // Step 1: Preview — show which staff will be included/skipped
      const previewResult = await previewPayrollRun(data);
      if (!previewResult.success) {
        toast.error(previewResult.error);
        return;
      }

      setPendingData(data);
      setPreview(previewResult.data);
    } catch (error) {
      console.error("Error previewing payroll run:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!pendingData) return;
    setIsSubmitting(true);

    try {
      const result = await createPayrollRun(pendingData);
      if (result.success) {
        toast.success("Payroll run created successfully");
        router.push(`/dashboard/payroll/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error("Error creating payroll run:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
      setPreview(null);
      setPendingData(null);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Payroll Period</CardTitle>
            <CardDescription>
              Select the pay period. Staff entries will be auto-populated from salary configurations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="periodStart">Period Start *</Label>
                <Input
                  id="periodStart"
                  type="date"
                  defaultValue={defaultStart}
                  onChange={(e) => {
                    if (e.target.value) {
                      setValue("periodStart", new Date(e.target.value + "T00:00:00"), { shouldValidate: true });
                    }
                  }}
                />
                {errors.periodStart && (
                  <p className="text-sm text-destructive">{errors.periodStart.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodEnd">Period End *</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  defaultValue={defaultEnd}
                  onChange={(e) => {
                    if (e.target.value) {
                      setValue("periodEnd", new Date(e.target.value + "T00:00:00"), { shouldValidate: true });
                    }
                  }}
                />
                {errors.periodEnd && (
                  <p className="text-sm text-destructive">{errors.periodEnd.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                {...register("notes")}
                placeholder="Optional notes for this payroll run..."
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Payroll Run
          </Button>
        </div>
      </form>

      {/* Preview Confirmation Dialog */}
      <AlertDialog open={!!preview} onOpenChange={() => { setPreview(null); setPendingData(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payroll Run</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <strong>{preview?.included.length}</strong> of{" "}
                  <strong>{preview?.totalStaff}</strong> staff members will be included in this payroll run.
                </p>

                {preview && preview.skipped.length > 0 && (
                  <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                      <div className="text-sm text-yellow-800 dark:text-yellow-300">
                        <p className="font-medium mb-1">
                          {preview.skipped.length} staff member{preview.skipped.length > 1 ? "s" : ""} will be skipped:
                        </p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {preview.skipped.map((s) => (
                            <li key={s.userId}>
                              {s.name} — {s.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {preview && preview.included.length > 0 && (
                  <p className="text-sm">
                    Do you want to proceed?
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleConfirmCreate}
              disabled={isSubmitting || !preview || preview.included.length === 0}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {preview && preview.included.length === 0
                ? "No staff to include"
                : `Create for ${preview?.included.length} staff`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
