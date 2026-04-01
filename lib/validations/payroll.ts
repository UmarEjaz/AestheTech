import { z } from "zod";
import { PayType, PayrollRunStatus } from "@prisma/client";

// Schema for creating/updating a salary config
export const salaryConfigSchema = z.object({
  userId: z.string().min(1, "Staff member is required"),
  payType: z.nativeEnum(PayType, { message: "Invalid pay type" }),
  baseRate: z
    .number()
    .positive("Base rate must be greater than 0")
    .max(99999999.99, "Base rate must not exceed 99,999,999.99")
    .refine((val) => Math.round(val * 100) / 100 === val, {
      message: "Base rate can have at most 2 decimal places",
    }),
  effectiveDate: z.coerce.date({ message: "Effective date is required" }),
  notes: z
    .string()
    .max(500, "Notes must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

// Schema for creating a payroll run
export const createPayrollRunSchema = z
  .object({
    periodStart: z.coerce.date({ message: "Period start date is required" }),
    periodEnd: z.coerce.date({ message: "Period end date is required" }),
    notes: z
      .string()
      .max(500, "Notes must be less than 500 characters")
      .optional()
      .or(z.literal("")),
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: "Period end must be on or after period start",
    path: ["periodEnd"],
  });

// Schema for updating a payroll entry
export const updatePayrollEntrySchema = z.object({
  id: z.string().min(1, "Entry ID is required"),
  basePay: z
    .number()
    .positive("Base pay must be greater than 0")
    .max(99999999.99, "Base pay must not exceed 99,999,999.99")
    .refine((val) => Math.round(val * 100) / 100 === val, {
      message: "Base pay can have at most 2 decimal places",
    }),
  bonus: z
    .number()
    .min(0, "Bonus cannot be negative")
    .max(99999999.99, "Bonus must not exceed 99,999,999.99")
    .refine((val) => Math.round(val * 100) / 100 === val, {
      message: "Bonus can have at most 2 decimal places",
    }),
  deductions: z
    .number()
    .min(0, "Deductions cannot be negative")
    .max(99999999.99, "Deductions must not exceed 99,999,999.99")
    .refine((val) => Math.round(val * 100) / 100 === val, {
      message: "Deductions can have at most 2 decimal places",
    }),
  deductionNotes: z
    .string()
    .max(500, "Deduction notes must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .max(500, "Notes must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

// Schema for payroll search/filter
export const payrollSearchSchema = z.object({
  status: z.nativeEnum(PayrollRunStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Types
export type SalaryConfigInput = z.infer<typeof salaryConfigSchema>;
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;
export type UpdatePayrollEntryInput = z.infer<typeof updatePayrollEntrySchema>;
export type PayrollSearchParams = z.input<typeof payrollSearchSchema>;

// Form input types (matches what react-hook-form produces)
export type SalaryConfigFormInput = {
  userId: string;
  payType: PayType;
  baseRate: number;
  effectiveDate: Date | string;
  notes?: string;
};
