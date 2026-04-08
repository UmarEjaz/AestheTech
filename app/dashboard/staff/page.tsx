import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { StaffTable } from "@/components/staff/staff-table";
import { getUsers } from "@/lib/actions/user";
import { getTimezone } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function StaffPage() {
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

  // Check if user can view staff
  if (!await hasPermission(userRole, "staff:view", isSuperAdmin, salonId, session.user.id)) {
    redirect("/dashboard/access-denied");
  }

  const canCreate = await hasPermission(userRole, "staff:create", isSuperAdmin, salonId, session.user.id);
  const canEdit = await hasPermission(userRole, "staff:update", isSuperAdmin, salonId, session.user.id);
  const canDelete = await hasPermission(userRole, "staff:delete", isSuperAdmin, salonId, session.user.id);

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
