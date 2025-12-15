import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ScheduleWeekView } from "@/components/schedules/schedule-week-view";
import { getStaffWithSchedules } from "@/lib/actions/schedule";
import { hasPermission } from "@/lib/permissions";

export default async function SchedulesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "schedules:manage");

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

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Staff Schedules</h1>
          <p className="text-muted-foreground">
            Manage working hours and availability for all staff members
          </p>
        </div>

        {/* Schedule View */}
        <ScheduleWeekView
          staffWithSchedules={staffResult.data}
          canManage={canManage}
        />
      </div>
    </DashboardLayout>
  );
}
