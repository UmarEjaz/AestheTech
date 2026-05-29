import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { getRoleDefinitions, getRoleBySlug } from "@/lib/actions/role";
import { RolesPageClient } from "./roles-client";

export default async function RolesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  const [canManageRoles, canManagePermissions] = await Promise.all([
    hasPermission(userRoleId, "roles:manage", isSuperAdmin, salonId, session.user.id),
    hasPermission(userRoleId, "permissions:manage", isSuperAdmin, salonId, session.user.id),
  ]);

  // Unified page: either permission lets the user open it. The client component
  // hides role-identity controls (create/edit/delete role) when `canManageRoles`
  // is false, and hides permission edits when `canManagePermissions` is false.
  if (!canManageRoles && !canManagePermissions) {
    redirectAccessDenied(["roles:manage"]);
  }

  const rolesResult = await getRoleDefinitions();

  if (!rolesResult.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{rolesResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  // Only prefetch permission data if user can manage permissions
  const firstRole = rolesResult.data[0];
  let initialPermData = null;
  if (canManagePermissions && firstRole) {
    const permResult = await getRoleBySlug(firstRole.slug);
    if (permResult.success) {
      initialPermData = permResult.data;
    }
  }

  return (
    <DashboardLayout>
      <RolesPageClient
        roles={rolesResult.data}
        initialPermData={initialPermData}
        canManageRoles={canManageRoles}
        canManagePermissions={canManagePermissions}
      />
    </DashboardLayout>
  );
}
