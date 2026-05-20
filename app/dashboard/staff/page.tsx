import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { StaffTable } from "@/components/staff/staff-table";
import { getUsers } from "@/lib/actions/user";
import { getTimezone } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function StaffPage() {
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

  // Check if user can view staff
  if (!await hasPermission(userRoleId, "staff:view", isSuperAdmin, salonId, session.user.id)) {
    redirectAccessDenied(["staff:view"]);
  }

  const canCreate = await hasPermission(userRoleId, "staff:create", isSuperAdmin, salonId, session.user.id);
  const canEdit = await hasPermission(userRoleId, "staff:update", isSuperAdmin, salonId, session.user.id);
  const canDelete = await hasPermission(userRoleId, "staff:delete", isSuperAdmin, salonId, session.user.id);

  const [usersResult, tz] = await Promise.all([
    getUsers({ page: 1, limit: 15 }),
    getTimezone(),
  ]);

  if (!usersResult.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{usersResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { users, total, page, totalPages } = usersResult.data;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Staff Management</h1>
          <p className="text-muted-foreground">
            Manage your salon&apos;s staff members and their roles
          </p>
        </div>

        {/* Staff Table with Search */}
        <StaffTable
          initialUsers={users}
          initialTotal={total}
          initialPage={page}
          initialTotalPages={totalPages}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          timezone={tz}
          fetchUsers={getUsers}
        />
      </div>
    </DashboardLayout>
  );
}
