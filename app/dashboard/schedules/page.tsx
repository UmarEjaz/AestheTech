import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { getStaffWithSchedules } from "@/lib/actions/schedule";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
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
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("schedules");
  const permUserId = actor.userId;
  if (!await hasPermission(userRoleId, "schedules:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["schedules:view"]);
  }
  const [canCreate, canUpdate] = await Promise.all([
    hasPermission(userRoleId, "schedules:create", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "schedules:update", isSuperAdmin, salonId, permUserId),
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
  const timezone = settingsResult.success ? settingsResult.data.timezone : "UTC";

  return (
    <>
      <SchedulePageClient
        staffWithSchedules={staffResult.data}
        canManage={canManage}
        salonName={salonName}
        timezone={timezone}
      />
    </>
  );
}
