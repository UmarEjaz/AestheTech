import { z } from "zod";

export const permissionUpdateSchema = z.object({
  assignments: z.array(
    z.object({
      permissionCode: z.string().min(1, "Permission code is required"),
      role: z.string().min(1, "Invalid role"),
      granted: z.boolean(),
    })
  ).max(500, "Too many permission changes in a single request"),
});

export type PermissionUpdateInput = z.infer<typeof permissionUpdateSchema>;

export const userPermissionUpdateSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  overrides: z.array(
    z.object({
      permissionCode: z.string().min(1, "Permission code is required"),
      overrideType: z.enum(["GRANT", "REVOKE"]),
    })
  ).max(100, "Too many permission overrides in a single request"),
});

export type UserPermissionUpdateInput = z.infer<typeof userPermissionUpdateSchema>;

export const rolePermissionUpdateSchema = z.object({
  roleName: z.string().min(1, "Role name is required"),
  grants: z.array(z.string().min(1)).max(200, "Too many grants in a single request"),
  revokes: z.array(z.string().min(1)).max(200, "Too many revocations in a single request"),
});

export type RolePermissionUpdateInput = z.infer<typeof rolePermissionUpdateSchema>;
