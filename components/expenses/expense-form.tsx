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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { createExpenseSchema, CreateExpenseInput, ExpenseFormInput } from "@/lib/validations/expense";
import { createExpense, updateExpense } from "@/lib/actions/expense";

interface ExpenseFormProps {
  expense?: {
    id: string;
    categoryId: string;
    amount: number | string;
    description: string | null;
    date: Date | string;
    receiptUrl: string | null;
    isRecurring: boolean;
  };
  mode: "create" | "edit";
  categories: { id: string; name: string; icon: string | null; color: string | null }[];
  currencyCode?: string;
}

export function ExpenseForm({ expense, mode, categories, currencyCode = "USD" }: ExpenseFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dateValue = expense?.date
    ? new Date(expense.date).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<ExpenseFormInput, unknown, CreateExpenseInput>({
    resolver: zodResolver(createExpenseSchema) as any,
    defaultValues: {
      categoryId: expense?.categoryId || "",
      amount: expense ? Number(expense.amount) : undefined,
      description: expense?.description || "",
      date: expense?.date ? new Date(expense.date) : new Date(),
      receiptUrl: expense?.receiptUrl || "",
      isRecurring: expense?.isRecurring ?? false,
    },
  });

  const isRecurring = watch("isRecurring");
  const categoryId = watch("categoryId");

  const onSubmit = async (data: CreateExpenseInput) => {
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createExpense(data);
        if (result.success) {
          toast.success("Expense created successfully");
          router.push("/dashboard/expenses");
        } else {
          toast.error(result.error);
        }
      } else if (expense) {
        const result = await updateExpense({ id: expense.id, ...data });
        if (result.success) {
          toast.success("Expense updated successfully");
          router.push("/dashboard/expenses");
        } else {
          toast.error(result.error);
        }
      }
    } catch (error) {
      console.error("Error saving expense:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Expense Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Category *</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => setValue("categoryId", value, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        {cat.color && (
                          <span
                            className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                        )}
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.categoryId && (
                <p className="text-sm text-destructive">{errors.categoryId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                defaultValue={dateValue}
                onChange={(e) => {
                  if (e.target.value) {
                    setValue("date", new Date(e.target.value + "T00:00:00"), { shouldValidate: true });
                  }
                }}
              />
              {errors.date && (
                <p className="text-sm text-destructive">{errors.date.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount ({currencyCode}) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                {...register("amount", { valueAsNumber: true })}
                placeholder="0.00"
                min="0.01"
              />
              {errors.amount && (
                <p className="text-sm text-destructive">{errors.amount.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="receiptUrl">Receipt URL</Label>
              <Input
                id="receiptUrl"
                {...register("receiptUrl")}
                placeholder="https://..."
              />
              {errors.receiptUrl && (
                <p className="text-sm text-destructive">{errors.receiptUrl.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              {...register("description")}
              placeholder="What was this expense for?"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isRecurring"
              checked={isRecurring}
              onCheckedChange={(checked) =>
                setValue("isRecurring", checked === true, { shouldValidate: true })
              }
            />
            <Label htmlFor="isRecurring" className="text-sm font-normal cursor-pointer">
              This is a recurring expense (e.g. monthly rent, subscription)
            </Label>
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
          {mode === "create" ? "Create Expense" : "Update Expense"}
        </Button>
      </div>
    </form>
  );
}
