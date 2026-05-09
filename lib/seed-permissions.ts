import { prisma } from "@/lib/prisma";
import { DEFAULT_PERMISSION_ROLES } from "@/lib/permissions-defaults";

/**
 * Seed default permissions for a newly created salon/branch.
 * This is NOT in a "use server" file, so it cannot be called from the browser.
 * Only server-side code (salon creation, branch creation, seed scripts) should call this.
 */
export async function seedPermissionsForSalon(salonId: string): Promise<void> {
  const allPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

  // Resolve role names to roleDefinitionIds
  const allRoleNames = [...new Set(Object.values(DEFAULT_PERMISSION_ROLES).flat())];
  const roleDefs = await prisma.roleDefinition.findMany({
    where: {
      name: { in: allRoleNames },
      OR: [{ isSystem: true }, { salonId }],
    },
    select: { id: true, name: true },
  });
  const roleNameToId = new Map(roleDefs.map((rd) => [rd.name, rd.id]));

  const missingCodes: string[] = [];
  const data: Array<{ salonId: string; roleDefinitionId: string; permissionId: string }> = [];
  for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
    const permId = permIdMap.get(code);
    if (!permId) {
      missingCodes.push(code);
      continue;
    }
    for (const roleName of roles) {
      const roleDefId = roleNameToId.get(roleName);
      if (!roleDefId) continue;
      data.push({ salonId, roleDefinitionId: roleDefId, permissionId: permId });
    }
  }

  // Prevent partial provisioning — keep runtime fallback defaults intact until catalog is complete
  if (missingCodes.length > 0) {
    console.warn("Skipping permission seed due to missing permission codes", { salonId, missingCodes });
    return;
  }
  if (data.length === 0) return;

  await prisma.rolePermission.createMany({ data, skipDuplicates: true });
}
