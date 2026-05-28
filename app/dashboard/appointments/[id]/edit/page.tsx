import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { getAppointment } from "@/lib/actions/appointment";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
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
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  // Fetch appointment first so we know which branch it belongs to.
  // All subsequent checks/loads use appointment.salonId — not the caller's current branch.
  const appointmentResult = await getAppointment(id);

  if (!appointmentResult.success || !appointmentResult.data) {
    notFound();
  }

  const appointment = appointmentResult.data;

  // Permission check scoped to the appointment's branch
  const canUpdate = await hasPermission(userRoleId, "appointments:update", isSuperAdmin, appointment.salonId, session.user.id);

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
  const [clients, services, staffRows] = await Promise.all([
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
  ]);
  const staff = staffRows.map((row) => row.user);

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/appointments">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to appointments</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Appointment</h1>
            <p className="text-muted-foreground">
              Update appointment for {appointment.client.firstName}{appointment.client.lastName ? ` ${appointment.client.lastName}` : ""}{appointment.client.isWalkIn ? " (Walk-in)" : ""}
            </p>
          </div>
        </div>

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
        />
      </div>
    </DashboardLayout>
  );
}
