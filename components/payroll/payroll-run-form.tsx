"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createPayrollRunSchema, CreatePayrollRunInput } from "@/lib/validations/payroll";
import { createPayrollRun } from "@/lib/actions/payroll";

type PayrollRunFormInput = {
  periodStart: Date | string;
  periodEnd: Date | string;
  notes?: string;
};

export function PayrollRunForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Default to current month
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

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
      const result = await createPayrollRun(data);
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
    }
  };

  return (
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
  );
}
