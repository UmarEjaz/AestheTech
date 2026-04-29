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

  const data: Array<{ salonId: string; role: string; permissionId: string }> = [];
  for (const [code, roles] of Object.entries(DEFAULT_PERMISSION_ROLES)) {
    const permId = permIdMap.get(code);
    if (!permId) continue;
    for (const role of roles) {
      data.push({ salonId, role, permissionId: permId });
    }
  }

  await prisma.rolePermission.createMany({ data, skipDuplicates: true });
}
