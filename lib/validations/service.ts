import { z } from "zod";

export const serviceSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(100, "Service name must be less than 100 characters"),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  duration: z
    .number()
    .int("Duration must be a whole number")
    .min(5, "Duration must be at least 5 minutes")
    .max(480, "Duration must be less than 8 hours"),
  price: z
    .number()
    .min(0, "Price must be a positive number")
    .max(10000, "Price must be less than $10,000"),
  points: z
    .number()
    .int("Points must be a whole number")
    .min(0, "Points must be a positive number")
    .default(0),
  category: z
    .string()
    .max(50, "Category must be less than 50 characters")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const serviceUpdateSchema = serviceSchema.partial().extend({
  id: z.string().min(1, "Service ID is required"),
});

export const serviceSearchSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ServiceFormData = z.infer<typeof serviceSchema>;
export type ServiceFormInput = z.input<typeof serviceSchema>;
export type ServiceUpdateData = z.infer<typeof serviceUpdateSchema>;
export type ServiceSearchParams = z.input<typeof serviceSearchSchema>;
