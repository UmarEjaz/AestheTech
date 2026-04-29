import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { getRoleDefinitions, getRoleBySlug } from "@/lib/actions/role";
import { RolesPageClient } from "./roles-client";

export default async function RolesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }

  const userRole = session.user.salonRole ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  if (!(await hasPermission(userRole, "roles:manage", isSuperAdmin, salonId, session.user.id))) {
    redirect("/dashboard/access-denied");
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

  // Pre-fetch permission data for the first role
  const firstRole = rolesResult.data[0];
  let initialPermData = null;
  if (firstRole) {
    const permResult = await getRoleBySlug(firstRole.slug);
    if (permResult.success) {
      initialPermData = permResult.data;
    }
  }

  return (
    <DashboardLayout>
      <RolesPageClient roles={rolesResult.data} initialPermData={initialPermData} />
    </DashboardLayout>
  );
}
