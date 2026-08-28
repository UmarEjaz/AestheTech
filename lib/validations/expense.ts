import { z } from "zod";

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
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseSearchParams = z.input<typeof expenseSearchSchema>;

// Form input type — the schema's INPUT type (pre-coercion), so it matches what zodResolver infers
// and the resolver needs no cast. (date is `unknown` and isRecurring optional at the input stage.)
export type ExpenseFormInput = z.input<typeof createExpenseSchema>;
