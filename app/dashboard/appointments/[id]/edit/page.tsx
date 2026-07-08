import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { getAppointment } from "@/lib/actions/appointment";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { prisma } from "@/lib/prisma";
import { getOrganizationSalonIds } from "@/lib/actions/branch";

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

  // Fetch clients, services, and staff for the form
  // - Clients/services: org-scoped against the appointment's organization
  // - Staff: scoped to the appointment's branch (so the currently assigned staff appears)
  const orgSalonIds = await getOrganizationSalonIds(appointment.salonId);
  const [clients, services, staffRows, settingsRow] = await Promise.all([
    prisma.client.findMany({
      where: { salonId: { in: orgSalonIds }, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
      orderBy: { firstName: "asc" },
    }),
    prisma.service.findMany({
      where: { salonId: appointment.salonId, isActive: true },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
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
  const staff = staffRows.map((row) => row.user);
  const timezone = settingsRow?.timezone || "UTC";

  return (
    // The form renders its own header (back button + title/subtitle).
    <AppointmentForm
      mode="edit"
      appointment={appointment}
      clients={clients}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        duration: s.duration,
        price: Number(s.price),
        category: s.category?.name ?? null,
      }))}
      staff={staff}
      timezone={timezone}
    />
  );
}
