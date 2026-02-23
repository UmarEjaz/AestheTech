import { z } from "zod";

export const productSchema = z.object({
  name: z
    .string()
    .min(1, "Product name is required")
    .max(100, "Product name must be less than 100 characters"),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  sku: z
    .string()
    .max(50, "SKU must be less than 50 characters")
    .optional()
    .or(z.literal("")),
  price: z
    .number()
    .min(0, "Price must be a non-negative number")
    .max(10000, "Price must be less than $10,000"),
  cost: z
    .number()
    .min(0, "Cost must be a non-negative number")
    .max(10000, "Cost must be less than $10,000")
    .optional()
    .nullable(),
  stock: z
    .number()
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative")
    .default(0),
  lowStockThreshold: z
    .number()
    .int("Threshold must be a whole number")
    .min(0, "Threshold cannot be negative")
    .default(5),
  points: z
    .number()
    .int("Points must be a whole number")
    .min(0, "Points must be a non-negative number")
    .default(0),
  category: z
    .string()
    .max(50, "Category must be less than 50 characters")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const productUpdateSchema = productSchema.partial().extend({
  id: z.string().min(1, "Product ID is required"),
});

export const productSearchSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  lowStock: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ProductFormData = z.infer<typeof productSchema>;
export type ProductFormInput = z.input<typeof productSchema>;
export type ProductUpdateData = z.infer<typeof productUpdateSchema>;
export type ProductSearchParams = z.input<typeof productSearchSchema>;
