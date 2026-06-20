import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { StaffTable } from "@/components/staff/staff-table";
import { getUsers } from "@/lib/actions/user";
import { getTimezone } from "@/lib/actions/settings";
import { getStaffUsage } from "@/lib/actions/staff-cap";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function StaffPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;

  // Check if user can view staff
  await requireModule("staff");
  const permUserId = actor.userId;
  if (!await hasPermission(userRoleId, "staff:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["staff:view"]);
  }

  const canCreatePerm = await hasPermission(userRoleId, "staff:create", isSuperAdmin, salonId, permUserId);
  const canEdit = await hasPermission(userRoleId, "staff:update", isSuperAdmin, salonId, permUserId);
  const canDelete = await hasPermission(userRoleId, "staff:delete", isSuperAdmin, salonId, permUserId);

  const [usersResult, tz, staffUsage] = await Promise.all([
    getUsers({ page: 1, limit: 15 }),
    getTimezone(),
    salonId ? getStaffUsage(salonId) : Promise.resolve(null),
  ]);

  // Effective super admin bypasses the seat cap; everyone else can only add when
  // there's room. The server enforces this too — this just keeps the UI honest.
  const atSeatLimit = !isSuperAdmin && staffUsage != null && !staffUsage.canAdd;
  const canCreate = canCreatePerm && !atSeatLimit;

  if (!usersResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{usersResult.error}</p>
        </div>
      </>
    );
  }

  const { users, total, page, totalPages } = usersResult.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Staff Management</h1>
          <p className="text-muted-foreground">
            Manage your salon&apos;s staff members and their roles
          </p>
          {staffUsage?.limit != null && (
            <p className="mt-1 text-sm text-muted-foreground">
              {staffUsage.used} of {staffUsage.limit} staff seats used
              {atSeatLimit && (
                <span className="ml-2 text-destructive">
                  · Seat limit reached — contact your administrator to add more.
                </span>
              )}
            </p>
          )}
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
          currentUserId={actor.userId}
          currentUserRole={session.user.salonRole ?? null}
          isSuperAdmin={isSuperAdmin}
          timezone={tz}
          fetchUsers={getUsers}
        />
      </div>
    </>
  );
}
