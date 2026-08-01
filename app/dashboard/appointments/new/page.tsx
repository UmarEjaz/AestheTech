import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { getActiveServices } from "@/lib/actions/service";
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ startTime?: string; staffId?: string }>;
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

  // Taking a deposit creates a Payment, so only offer it to roles with the financial permission
  // (the deposit action enforces this too; this just hides the toggle so they never try).
  const canTakeDeposit = await hasPermission(userRoleId, "sales:create", isSuperAdmin, salonId, permUserId);

  if (!salonId) {
    redirect("/dashboard");
  }

  // The client picker searches the DB on demand (server-side), so we no longer load every client.
  // Services are a bounded menu (like products), so we load them all for instant browser filtering.
  const [servicesResult, staffRows, settingsRow] = await Promise.all([
    getActiveServices(),
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
      select: { defaultBookingMode: true, timezone: true },
    }),
  ]);
  const services = servicesResult.success ? servicesResult.data : [];
  const staff = staffRows.map((row) => row.user);
  const defaultBookingMode =
    settingsRow?.defaultBookingMode === "WALK_IN" ? "WALK_IN" : "APPOINTMENT";
  const timezone = settingsRow?.timezone || "UTC";

  // Parse initial date from URL if provided
  const initialDate = params.startTime ? new Date(params.startTime) : undefined;
  // Pre-select a provider when booking from a staff lane (only if they're a valid provider here).
  const initialStaffId =
    params.staffId && staff.some((m) => m.id === params.staffId) ? params.staffId : undefined;

  return (
    // The form renders its own header (title/subtitle react to the Walk-in ⇄ Appointment toggle).
    <>
      {!servicesResult.success && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/20 dark:text-yellow-200">
          Couldn&apos;t load the service menu, so the service picker will be empty. You may not have
          permission to view services — ask an admin to grant it.
        </div>
      )}
      <AppointmentForm
        mode="create"
        services={services}
        staff={staff}
        initialDate={initialDate}
        initialStaffId={initialStaffId}
        defaultBookingMode={defaultBookingMode}
        timezone={timezone}
        canTakeDeposit={canTakeDeposit}
      />
    </>
  );
}
