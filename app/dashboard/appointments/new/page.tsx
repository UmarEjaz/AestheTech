import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { prisma } from "@/lib/prisma";
import { getOrganizationSalonIds } from "@/lib/actions/branch";

interface PageProps {
  searchParams: Promise<{ startTime?: string }>;
}

export default async function NewAppointmentPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("appointments");
  const permUserId = actor.userId;
  const canCreate = await hasPermission(userRoleId, "appointments:create", isSuperAdmin, salonId, permUserId);

  if (!canCreate) {
    redirectAccessDenied(["appointments:create"]);
  }

  if (!salonId) {
    redirect("/dashboard");
  }

  // Fetch clients, services, and staff for the form (org-scoped)
  const orgSalonIds = await getOrganizationSalonIds(salonId);
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
      where: { salonId, isActive: true },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Resolve providers via branch membership (UserSalon) so staff assigned to this
    // branch are included regardless of their volatile `User.salonId` value.
    prisma.userSalon.findMany({
      where: {
        salonId,
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
      where: { salonId },
      select: { defaultAppointmentClientType: true, timezone: true },
    }),
  ]);
  const staff = staffRows.map((row) => row.user);
  const defaultClientType =
    settingsRow?.defaultAppointmentClientType === "WALK_IN" ? "WALK_IN" : "EXISTING";
  const timezone = settingsRow?.timezone || "UTC";

  // Parse initial date from URL if provided
  const initialDate = params.startTime ? new Date(params.startTime) : undefined;

  return (
    // The form renders its own header (title/subtitle react to the Walk-in ⇄ Appointment toggle).
    <AppointmentForm
      mode="create"
      clients={clients}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        duration: s.duration,
        price: Number(s.price),
        category: s.category?.name ?? null,
      }))}
      staff={staff}
      initialDate={initialDate}
      defaultClientType={defaultClientType}
      timezone={timezone}
    />
  );
}
