import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { getStaffWithSchedules } from "@/lib/actions/schedule";
import { hasPermission } from "@/lib/permissions";
import { getSettings } from "@/lib/actions/settings";
import { SchedulePageClient } from "@/components/schedules/schedule-page-client";

export default async function SchedulesPage() {
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
  const canManage = await hasPermission(userRole, "schedules:manage", isSuperAdmin, salonId, session.user.id);

  const staffResult = await getStaffWithSchedules();

  if (!staffResult.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{staffResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const settingsResult = await getSettings();
  const salonName = settingsResult.success ? settingsResult.data.salonName : "AestheTech Salon";

  return (
    <DashboardLayout>
      <SchedulePageClient
        staffWithSchedules={staffResult.data}
        canManage={canManage}
        salonName={salonName}
      />
    </DashboardLayout>
  );
}
