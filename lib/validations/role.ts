import { z } from "zod";

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name must be less than 50 characters")
    .regex(/^[a-zA-Z0-9_ ]+$/, "Role name can only contain letters, numbers, spaces, and underscores"),
  label: z
    .string()
    .min(1, "Display label is required")
    .max(50, "Display label must be less than 50 characters"),
  description: z.string().max(200, "Description must be less than 200 characters").optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .default("#6B7280"),
  hierarchyLevel: z
    .number()
    .int()
    .min(1, "Hierarchy level must be at least 1")
    .max(99, "Hierarchy level must be at most 99"),
});

export const updateRoleSchema = z.object({
  id: z.string().min(1, "Role ID is required"),
  label: z
    .string()
    .min(1, "Display label is required")
    .max(50, "Display label must be less than 50 characters")
    .optional(),
  description: z.string().max(200, "Description must be less than 200 characters").optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  hierarchyLevel: z
    .number()
    .int()
    .min(1, "Hierarchy level must be at least 1")
    .max(99, "Hierarchy level must be at most 99")
    .optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
