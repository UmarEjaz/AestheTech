import { auth } from "@/lib/auth";
import { getPermissionsForRole } from "@/lib/permissions";
import { PermissionsProvider } from "@/lib/permissions-context";
import { RolesProvider } from "@/lib/roles-context";
import { ModulesProvider } from "@/lib/modules-context";
import { getDisabledModulesForSalon } from "@/lib/actions/modules";
import { getEffectiveActor } from "@/lib/effective-actor";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ROLE_DEFINITIONS } from "@/lib/roles";
import { DashboardLayout as DashboardChrome } from "@/components/layout/dashboard-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const roleId = session?.user?.salonRoleId ?? null;
  const isSuperAdmin = session?.user?.isSuperAdmin ?? false;
  const salonId = session?.user?.salonId ?? null;
  // Use the borrowed user's id during "Login as Owner" so per-user permission
  // overrides resolve faithfully (the permissions context drives the sidebar).
  const userId = session?.user ? getEffectiveActor(session.user).userId : null;

  const [permissions, roleDefs, disabledModules] = await Promise.all([
    getPermissionsForRole(roleId, isSuperAdmin, salonId, userId),
    loadRoleDefinitions(salonId),
    // Effective super admin ("Enter salon") sees all modules — pass an empty
    // disabled list. Otherwise (incl. "Login as Owner") respect the salon's toggles.
    isSuperAdmin || !salonId ? Promise.resolve([]) : getDisabledModulesForSalon(salonId),
  ]);

  // The chrome (sidebar + header) is mounted ONCE here so it persists across
  // navigations within /dashboard — only the page content below remounts.
  return (
    <PermissionsProvider permissions={permissions}>
      <RolesProvider roles={roleDefs}>
        <ModulesProvider disabledModules={disabledModules}>
          <DashboardChrome isSuperAdmin={isSuperAdmin}>{children}</DashboardChrome>
        </ModulesProvider>
      </RolesProvider>
    </PermissionsProvider>
  );
}

async function loadRoleDefinitions(salonId: string | null) {
  if (!salonId) {
    return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
      name: r.name,
      slug: r.slug,
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
      select: { name: true, slug: true, color: true, hierarchyLevel: true, isSystem: true },
    });

    if (roles.length === 0) {
      return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
        name: r.name,
        slug: r.slug,
        color: r.color,
        hierarchyLevel: r.hierarchyLevel,
        isSystem: r.isSystem,
      }));
    }

    return roles;
  } catch {
    return SYSTEM_ROLE_DEFINITIONS.map((r) => ({
      name: r.name,
      slug: r.slug,
      color: r.color,
      hierarchyLevel: r.hierarchyLevel,
      isSystem: r.isSystem,
    }));
  }
}
