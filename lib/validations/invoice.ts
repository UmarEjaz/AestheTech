import { z } from "zod";
import { InvoiceStatus, PaymentMethod } from "@prisma/client";

// Schema for invoice search/filter
export const invoiceSearchSchema = z.object({
  query: z.string().optional(),
  clientId: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

// Schema for adding payment to invoice
export const addPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Invoice ID is required"),
  amount: z.number().min(0.01, "Payment amount must be positive"),
  method: z.nativeEnum(PaymentMethod),
});

// Schema for updating invoice status
export const updateInvoiceStatusSchema = z.object({
  status: z.nativeEnum(InvoiceStatus),
});

// Types
export type InvoiceSearchParams = z.input<typeof invoiceSearchSchema>;
export type AddPaymentInput = z.infer<typeof addPaymentSchema>;
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
