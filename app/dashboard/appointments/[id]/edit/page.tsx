import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { getAppointment } from "@/lib/actions/appointment";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { getActiveServices } from "@/lib/actions/service";
import { prisma } from "@/lib/prisma";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditAppointmentPage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  await requireModule("appointments");

  // Fetch appointment first so we know which branch it belongs to.
  // All subsequent checks/loads use appointment.salonId — not the caller's current branch.
  const appointmentResult = await getAppointment(id);

  if (!appointmentResult.success || !appointmentResult.data) {
    notFound();
  }

  const appointment = appointmentResult.data;

  // Permission check scoped to the appointment's branch
  const permUserId = actor.userId;
  const canUpdate = await hasPermission(userRoleId, "appointments:update", isSuperAdmin, appointment.salonId, permUserId);

  if (!canUpdate) {
    redirectAccessDenied(["appointments:update"]);
  }

  // Check if appointment can be edited
  if (appointment.status === "COMPLETED" || appointment.status === "CANCELLED") {
    redirect("/dashboard/appointments");
  }

  // Fetch staff + services for the form. The client picker searches the DB on demand (server-side),
  // so we no longer load every client; services are a bounded menu loaded up front for the picker.
  const [servicesResult, staffRows, settingsRow] = await Promise.all([
    getActiveServices(appointment.salonId),
    // Resolve providers via branch membership (UserSalon) so staff assigned to
    // this branch are included even when it isn't their home branch.
    prisma.userSalon.findMany({
      where: {
        salonId: appointment.salonId,
        isActive: true,
        user: { isActive: true, isServiceProvider: true },
      },
      select: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      distinct: ["userId"],
      orderBy: { user: { firstName: "asc" } },
    }),
    prisma.settings.findUnique({
      where: { salonId: appointment.salonId },
      select: { timezone: true },
    }),
  ]);
  const services = servicesResult.success ? servicesResult.data : [];
  const staff = staffRows.map((row) => row.user);
  const timezone = settingsRow?.timezone || "UTC";

  return (
    // The form renders its own header (back button + title/subtitle).
    <>
      {!servicesResult.success && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/20 dark:text-yellow-200">
          Couldn&apos;t load the service menu, so the service picker will be empty — saving may drop
          this appointment&apos;s services. You may not have permission to view services; ask an admin
          before editing.
        </div>
      )}
      <AppointmentForm
        mode="edit"
        appointment={appointment}
        services={services}
        staff={staff}
        timezone={timezone}
      />
    </>
  );
}
