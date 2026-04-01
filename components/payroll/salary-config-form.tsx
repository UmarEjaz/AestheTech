"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PayType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { salaryConfigSchema, SalaryConfigInput, SalaryConfigFormInput } from "@/lib/validations/payroll";
import { createSalaryConfig, updateSalaryConfig } from "@/lib/actions/salary-config";

interface SalaryConfigFormProps {
  config?: {
    id: string;
    userId: string;
    payType: string;
    baseRate: number | string;
    effectiveDate: Date | string;
    notes: string | null;
  };
  mode: "create" | "edit";
  staff: { id: string; firstName: string; lastName: string; email: string; role: string }[];
  currencyCode?: string;
}

export function SalaryConfigForm({ config, mode, staff, currencyCode = "USD" }: SalaryConfigFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dateValue = config?.effectiveDate
    ? new Date(config.effectiveDate).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<SalaryConfigFormInput, unknown, SalaryConfigInput>({
    resolver: zodResolver(salaryConfigSchema) as any,
    defaultValues: {
      userId: config?.userId || "",
      payType: (config?.payType as PayType) || PayType.MONTHLY,
      baseRate: config ? Number(config.baseRate) : undefined,
      effectiveDate: config?.effectiveDate ? new Date(config.effectiveDate) : new Date(),
      notes: config?.notes || "",
    },
  });

  const userId = watch("userId");
  const payType = watch("payType");

  const onSubmit = async (data: SalaryConfigInput) => {
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createSalaryConfig(data);
        if (result.success) {
          toast.success("Salary configuration created");
          router.push("/dashboard/payroll/salary-config");
        } else {
          toast.error(result.error);
        }
      } else if (config) {
        const result = await updateSalaryConfig(config.id, data);
        if (result.success) {
          toast.success("Salary configuration updated");
          router.push("/dashboard/payroll/salary-config");
        } else {
          toast.error(result.error);
        }
      }
    } catch (error) {
      console.error("Error saving salary config:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Salary Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="userId">Staff Member *</Label>
              <Select
                value={userId}
                onValueChange={(value) => setValue("userId", value, { shouldValidate: true })}
                disabled={mode === "edit"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} ({s.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.userId && (
                <p className="text-sm text-destructive">{errors.userId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payType">Pay Type *</Label>
              <Select
                value={payType}
                onValueChange={(value) => setValue("payType", value as PayType, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pay type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PayType.MONTHLY}>Monthly</SelectItem>
                  <SelectItem value={PayType.HOURLY}>Hourly</SelectItem>
                </SelectContent>
              </Select>
              {errors.payType && (
                <p className="text-sm text-destructive">{errors.payType.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="baseRate">Base Rate ({currencyCode}) *</Label>
              <Input
                id="baseRate"
                type="number"
                step="0.01"
                {...register("baseRate", { valueAsNumber: true })}
                placeholder="0.00"
                min="0.01"
              />
              {errors.baseRate && (
                <p className="text-sm text-destructive">{errors.baseRate.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Effective Date *</Label>
              <Input
                id="effectiveDate"
                type="date"
                defaultValue={dateValue}
                onChange={(e) => {
                  if (e.target.value) {
                    setValue("effectiveDate", new Date(e.target.value + "T00:00:00"), { shouldValidate: true });
                  }
                }}
              />
              {errors.effectiveDate && (
                <p className="text-sm text-destructive">{errors.effectiveDate.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              {...register("notes")}
              placeholder="Optional notes about this salary configuration..."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.notes && (
              <p className="text-sm text-destructive">{errors.notes.message}</p>
            )}
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
          {mode === "create" ? "Create Configuration" : "Update Configuration"}
        </Button>
      </div>
    </form>
  );
}
