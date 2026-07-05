import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AppointmentCalendar } from "@/components/appointments/appointment-calendar";
import { getAppointmentsForCalendar, getStaffForAppointments } from "@/lib/actions/appointment";
import { getSettings } from "@/lib/actions/settings";
import { getWeekRange } from "@/lib/utils/timezone";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function AppointmentsPage() {
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
  const permUserId = actor.userId;
  const [canView, canCreate, canUpdate, canCancel, canDelete] = await Promise.all([
    hasPermission(userRoleId, "appointments:view", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "appointments:create", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "appointments:update", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "appointments:cancel", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "appointments:delete", isSuperAdmin, salonId, permUserId),
  ]);

  await requireModule("appointments");
  if (!canView) {
    redirectAccessDenied(["appointments:view"]);
  }

  // Get settings first to determine timezone, then compute week range
  const settingsResult = await getSettings();
  const settings = settingsResult.success
    ? settingsResult.data
    : { businessHoursStart: "09:00", businessHoursEnd: "19:00", timezone: "UTC" };

  const { start: weekStart, end: weekEnd } = getWeekRange(settings.timezone);

  const [appointmentsResult, staffResult] = await Promise.all([
    getAppointmentsForCalendar({
      startDate: weekStart,
      endDate: weekEnd,
    }),
    getStaffForAppointments(),
  ]);
  const staff = staffResult.success ? staffResult.data : [];

  if (!appointmentsResult.success) {
    return (
      <>
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Appointments</h1>
              <p className="text-muted-foreground">Manage and schedule appointments</p>
            </div>
          </div>
          <div className="rounded-md border p-4 text-sm text-destructive">
            {appointmentsResult.error}
          </div>
        </div>
      </>
    );
  }

  const appointments = appointmentsResult.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Appointments</h1>
            <p className="text-muted-foreground">
              Manage and schedule appointments
            </p>
          </div>
          {canCreate && (
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
            canCreate={canCreate}
            canUpdate={canUpdate}
            canCancel={canCancel}
            canDelete={canDelete}
            staff={staff}
            businessHoursStart={settings.businessHoursStart}
            businessHoursEnd={settings.businessHoursEnd}
            timezone={settings.timezone}
          />
        </div>
      </div>
    </>
  );
}
