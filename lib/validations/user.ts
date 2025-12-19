import { z } from "zod";
import { Role } from "@prisma/client";

export const userSchema = z.object({
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
    .min(1, "Email is required")
    .email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z.string().min(1, "Please confirm password"),
  phone: z
    .string()
    .max(20, "Phone number must be less than 20 characters")
    .regex(/^[\d\s\-+()]*$/, "Invalid phone number format")
    .optional()
    .or(z.literal("")),
  role: z.nativeEnum(Role, {
    message: "Please select a valid role",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const userUpdateSchema = z.object({
  id: z.string().min(1, "User ID is required"),
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
    .min(1, "Email is required")
    .email("Invalid email address"),
  phone: z
    .string()
    .max(20, "Phone number must be less than 20 characters")
    .regex(/^[\d\s\-+()]*$/, "Invalid phone number format")
    .optional()
    .or(z.literal("")),
  role: z.nativeEnum(Role, {
    message: "Please select a valid role",
  }),
  isActive: z.boolean().optional(),
});

export const passwordChangeSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z.string().min(1, "Please confirm password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const userSearchSchema = z.object({
  query: z.string().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type UserFormData = z.infer<typeof userSchema>;
export type UserFormInput = z.input<typeof userSchema>;
export type UserUpdateData = z.infer<typeof userUpdateSchema>;
export type PasswordChangeData = z.infer<typeof passwordChangeSchema>;
export type UserSearchParams = z.input<typeof userSearchSchema>;
