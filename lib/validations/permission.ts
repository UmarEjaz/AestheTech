import { z } from "zod";

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
  // Use the role's database ID, not its slug. Slugs aren't globally unique (system + custom
  // share namespaces), so ID is the only unambiguous reference.
  roleDefinitionId: z.string().min(1, "Role ID is required"),
  grants: z.array(z.string().min(1, "Permission code is required")).max(200, "Too many grants in a single request"),
  revokes: z.array(z.string().min(1, "Permission code is required")).max(200, "Too many revocations in a single request"),
});

export type RolePermissionUpdateInput = z.infer<typeof rolePermissionUpdateSchema>;
