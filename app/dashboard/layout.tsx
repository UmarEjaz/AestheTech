import { auth } from "@/lib/auth";
import { getPermissionsForRole } from "@/lib/permissions";
import { PermissionsProvider } from "@/lib/permissions-context";
import { RolesProvider } from "@/lib/roles-context";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = session?.user?.salonRole ?? null;
  const isSuperAdmin = session?.user?.isSuperAdmin ?? false;
  const salonId = session?.user?.salonId ?? null;
  const userId = session?.user?.id ?? null;

  const [permissions, roleDefs] = await Promise.all([
    getPermissionsForRole(role, isSuperAdmin, salonId, userId),
    loadRoleDefinitions(salonId),
  ]);

  return (
    <PermissionsProvider permissions={permissions}>
      <RolesProvider roles={roleDefs}>
        {children}
      </RolesProvider>
    </PermissionsProvider>
  );
}

async function loadRoleDefinitions(salonId: string | null) {
  if (!salonId) {
    return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
      name: r.name,
      label: r.label,
      color: r.color,
      hierarchyLevel: r.hierarchyLevel,
      isSystem: r.isSystem,
    }));
  }

  try {
    const roles = await prisma.roleDefinition.findMany({
      where: {
        OR: [{ salonId: null, isSystem: true }, { salonId }],
        isActive: true,
      },
      orderBy: { hierarchyLevel: "desc" },
      select: { name: true, label: true, color: true, hierarchyLevel: true, isSystem: true },
    });

    if (roles.length === 0) {
      return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
        name: r.name,
        label: r.label,
        color: r.color,
        hierarchyLevel: r.hierarchyLevel,
        isSystem: r.isSystem,
      }));
    }

    return roles;
  } catch {
    return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
      name: r.name,
      label: r.label,
      color: r.color,
      hierarchyLevel: r.hierarchyLevel,
      isSystem: r.isSystem,
    }));
  }
}
