import { z } from "zod";

export const productCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name too long"),
  icon: z.string().max(50).optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional()
    .or(z.literal("")),
});

export type ProductCategoryInput = z.infer<typeof productCategorySchema>;
