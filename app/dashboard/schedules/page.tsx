import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getStaffWithSchedules } from "@/lib/actions/schedule";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { getSettings } from "@/lib/actions/settings";
import { SchedulePageClient } from "@/components/schedules/schedule-page-client";

export default async function SchedulesPage() {
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
  if (!await hasPermission(userRoleId, "schedules:view", isSuperAdmin, salonId, session.user.id)) {
    redirectAccessDenied(["schedules:view"]);
  }
  const [canCreate, canUpdate] = await Promise.all([
    hasPermission(userRoleId, "schedules:create", isSuperAdmin, salonId, session.user.id),
    hasPermission(userRoleId, "schedules:update", isSuperAdmin, salonId, session.user.id),
  ]);
  const canManage = canCreate || canUpdate;

  const staffResult = await getStaffWithSchedules();

  if (!staffResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{staffResult.error}</p>
        </div>
      </>
    );
  }

  const settingsResult = await getSettings();
  const salonName = settingsResult.success ? settingsResult.data.salonName : "AestheTech Salon";

  return (
    <>
      <SchedulePageClient
        staffWithSchedules={staffResult.data}
        canManage={canManage}
        salonName={salonName}
      />
    </>
  );
}
