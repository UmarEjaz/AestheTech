import { z } from "zod";

export const permissionUpdateSchema = z.object({
  assignments: z.array(
    z.object({
      permissionCode: z.string().min(1, "Permission code is required"),
      role: z.string().min(1, "Invalid role"),
      granted: z.boolean(),
    })
  ),
});

export type PermissionUpdateInput = z.infer<typeof permissionUpdateSchema>;

export const userPermissionUpdateSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  overrides: z.array(
    z.object({
      permissionCode: z.string().min(1, "Permission code is required"),
      overrideType: z.enum(["GRANT", "REVOKE"]),
    })
  ),
});

export type UserPermissionUpdateInput = z.infer<typeof userPermissionUpdateSchema>;
