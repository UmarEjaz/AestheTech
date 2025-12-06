import { z } from "zod";

export const clientSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(50, "First name must be less than 50 characters"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(50, "Last name must be less than 50 characters"),
  email: z
    .string()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(20, "Phone number must be less than 20 characters")
    .regex(/^[\d\s\-+()]+$/, "Invalid phone number format"),
  birthday: z.string().optional().or(z.literal("")),
  address: z.string().max(200, "Address must be less than 200 characters").optional().or(z.literal("")),
  notes: z.string().max(1000, "Notes must be less than 1000 characters").optional().or(z.literal("")),
  preferences: z.string().max(500, "Preferences must be less than 500 characters").optional().or(z.literal("")),
  allergies: z.string().max(500, "Allergies must be less than 500 characters").optional().or(z.literal("")),
  tags: z.array(z.string()).default([]),
});

export const clientUpdateSchema = clientSchema.partial().extend({
  id: z.string().min(1, "Client ID is required"),
});

export const clientSearchSchema = z.object({
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type ClientFormData = z.infer<typeof clientSchema>;
export type ClientFormInput = z.input<typeof clientSchema>;
export type ClientUpdateData = z.infer<typeof clientUpdateSchema>;
export type ClientSearchParams = z.input<typeof clientSearchSchema>;
