import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
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
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const canManage = hasPermission(userRole, "schedules:manage", isSuperAdmin);

  const staffResult = await getStaffWithSchedules();

  if (!staffResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{staffResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const settingsResult = await getSettings();
  const salonName = settingsResult.success ? settingsResult.data.salonName : "AestheTech Salon";

  return (
    <DashboardLayout userRole={userRole}>
      <SchedulePageClient
        staffWithSchedules={staffResult.data}
        canManage={canManage}
        salonName={salonName}
      />
    </DashboardLayout>
  );
}
