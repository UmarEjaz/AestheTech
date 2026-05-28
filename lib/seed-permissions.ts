import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PERMISSION_ROLES } from "@/lib/permissions-defaults";

/**
 * Seed default permissions for a newly created salon/branch.
 * This is NOT in a "use server" file, so it cannot be called from the browser.
 * Only server-side code (salon creation, branch creation, seed scripts) should call this.
 *
 * Accepts an optional `tx` so callers can run the seed inside the same transaction that
 * creates the salon/roles — guaranteeing the branch never commits in a half-built state.
 */
export async function seedPermissionsForSalon(
  salonId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? prisma;

  const allPermissions = await client.permission.findMany({
    select: { id: true, code: true },
  });
  const permIdMap = new Map(allPermissions.map((p) => [p.code, p.id]));

  // Resolve role slugs to roleDefinitionIds (DEFAULT_PERMISSION_ROLES values are slugs)
  const allRoleSlugs = [...new Set(Object.values(DEFAULT_PERMISSION_ROLES).flat())];
  const roleDefs = await client.roleDefinition.findMany({
    where: {
      slug: { in: allRoleSlugs },
      OR: [{ isSystem: true }, { salonId }],
    },
    select: { id: true, slug: true },
  });
  const roleSlugToId = new Map(roleDefs.map((rd) => [rd.slug, rd.id]));

  const missingCodes: string[] = [];
  const missingRoleSlugs: string[] = [];
  const data: Array<{ salonId: string; roleDefinitionId: string; permissionId: string }> = [];
  for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
    const permId = permIdMap.get(code);
    if (!permId) {
      missingCodes.push(code);
      continue;
    }
    for (const roleSlug of roles) {
      const roleDefId = roleSlugToId.get(roleSlug);
      if (!roleDefId) {
        missingRoleSlugs.push(roleSlug);
        continue;
      }
      data.push({ salonId, roleDefinitionId: roleDefId, permissionId: permId });
    }
  }

  // Prevent partial provisioning — keep runtime fallback defaults intact until catalog is complete
  if (missingCodes.length > 0) {
    console.warn("Skipping permission seed due to missing permission codes", { salonId, missingCodes });
    return;
  }
  if (missingRoleSlugs.length > 0) {
    console.warn("Skipping permission seed due to missing role definitions", {
      salonId,
      missingRoleSlugs: [...new Set(missingRoleSlugs)],
    });
    return;
  }
  if (data.length === 0) return;

  await client.rolePermission.createMany({ data, skipDuplicates: true });
}
