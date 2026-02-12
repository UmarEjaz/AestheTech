import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { AppointmentCalendar } from "@/components/appointments/appointment-calendar";
import { getAppointmentsForCalendar } from "@/lib/actions/appointment";
import { getSettings } from "@/lib/actions/settings";
import { getWeekRange } from "@/lib/utils/timezone";
import { hasPermission } from "@/lib/permissions";

export default async function AppointmentsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "appointments:create");

  // Get settings first to determine timezone, then compute week range
  const settingsResult = await getSettings();
  const settings = settingsResult.success
    ? settingsResult.data
    : { businessHoursStart: "09:00", businessHoursEnd: "19:00", timezone: "UTC" };

  const { start: weekStart, end: weekEnd } = getWeekRange(settings.timezone);

  const appointmentsResult = await getAppointmentsForCalendar({
    startDate: weekStart,
    endDate: weekEnd,
  });

  const appointments = appointmentsResult.success ? appointmentsResult.data : [];

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Appointments</h1>
            <p className="text-muted-foreground">
              Manage and schedule appointments
            </p>
          </div>
          {canManage && (
            <Button asChild>
              <Link href="/dashboard/appointments/new">
                <Plus className="mr-2 h-4 w-4" />
                Book Appointment
              </Link>
            </Button>
          )}
        </div>

        {/* Calendar View */}
        <div className="rounded-lg border bg-card p-4">
          <AppointmentCalendar
            initialAppointments={appointments}
            canManage={canManage}
            businessHoursStart={settings.businessHoursStart}
            businessHoursEnd={settings.businessHoursEnd}
            timezone={settings.timezone}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
