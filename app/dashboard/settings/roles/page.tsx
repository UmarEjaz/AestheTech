import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { getRoleDefinitions } from "@/lib/actions/role";
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

  if (!(await hasPermission(userRole, "settings:manage", isSuperAdmin, salonId, session.user.id))) {
    redirect("/dashboard/access-denied");
  }

  const result = await getRoleDefinitions();

  if (!result.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <RolesPageClient roles={result.data} />
    </DashboardLayout>
  );
}
