import { z } from "zod";

// Schema for creating/updating an expense category
export const expenseCategorySchema = z.object({
  name: z
    .string()
    .min(1, "Category name is required")
    .max(50, "Category name must be less than 50 characters"),
  icon: z
    .string()
    .max(30, "Icon name must be less than 30 characters")
    .optional()
    .or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color (e.g. #FF5733)")
    .optional()
    .or(z.literal("")),
});

// Schema for creating an expense
export const createExpenseSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  amount: z
    .number()
    .positive("Amount must be greater than 0")
    .max(99999999.99, "Amount must not exceed 99,999,999.99")
    .refine((val) => Math.round(val * 100) / 100 === val, {
      message: "Amount can have at most 2 decimal places",
    }),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  date: z.coerce.date({ message: "Date is required" }),
  receiptUrl: z
    .string()
    .url({ protocol: /^https?$/, message: "Receipt URL must be a valid HTTP(S) URL" })
    .optional()
    .or(z.literal("")),
  isRecurring: z.boolean().default(false),
});

// Schema for updating an expense
export const updateExpenseSchema = createExpenseSchema.partial().extend({
  id: z.string().min(1, "Expense ID is required"),
});

// Schema for expense search/filter
export const expenseSearchSchema = z.object({
  query: z.string().optional(),
  categoryId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  isRecurring: z.boolean().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Types — output types (after Zod validation/coercion)
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseSearchParams = z.input<typeof expenseSearchSchema>;

// Form input type — matches what react-hook-form fields produce (date as string or Date)
export type ExpenseFormInput = {
  categoryId: string;
  amount: number;
  description?: string;
  date: Date | string;
  receiptUrl?: string;
  isRecurring: boolean;
};
