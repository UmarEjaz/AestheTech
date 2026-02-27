import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

// Schema for individual sale item
export const saleItemSchema = z.object({
  serviceId: z.string().optional(),
  staffId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1").default(1),
  price: z.number().min(0, "Price must be a positive number"),
}).refine(
  (data) => (data.serviceId && !data.productId) || (!data.serviceId && data.productId),
  { message: "Exactly one of service or product is required" }
).refine(
  (data) => !data.serviceId || data.staffId,
  { message: "Staff member is required for services" }
);

// Schema for creating a sale
export const createSaleSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  items: z
    .array(saleItemSchema)
    .min(1, "At least one item is required"),
  discount: z
    .number()
    .min(0, "Discount cannot be negative")
    .default(0),
  discountType: z
    .enum(["percentage", "fixed"])
    .default("fixed"),
  notes: z
    .string()
    .max(500, "Notes must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

// Schema for payment
export const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().min(0.01, "Payment amount must be positive"),
});

// Schema for completing a sale with payment
export const completeSaleSchema = z.object({
  saleId: z.string().min(1, "Sale ID is required"),
  payments: z
    .array(paymentSchema)
    .min(1, "At least one payment method is required"),
  redeemPoints: z
    .number()
    .int()
    .min(0, "Points cannot be negative")
    .default(0),
});

// Schema for sale search/filter
export const saleSearchSchema = z.object({
  query: z.string().optional(),
  clientId: z.string().optional(),
  staffId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

// Types
export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
export type SaleSearchParams = z.input<typeof saleSearchSchema>;
