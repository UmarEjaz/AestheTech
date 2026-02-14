import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { getAppointment } from "@/lib/actions/appointment";
import { hasPermission } from "@/lib/permissions";
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
  const userRole = session.user.role as Role;
  const canUpdate = hasPermission(userRole, "appointments:update");

  if (!canUpdate) {
    redirect("/dashboard/access-denied");
  }

  // Fetch appointment
  const appointmentResult = await getAppointment(id);

  if (!appointmentResult.success || !appointmentResult.data) {
    notFound();
  }

  const appointment = appointmentResult.data;

  // Check if appointment can be edited
  if (appointment.status === "COMPLETED" || appointment.status === "CANCELLED") {
    redirect("/dashboard/appointments");
  }

  // Fetch clients, services, and staff for the form
  const [clients, services, staff] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
      orderBy: { firstName: "asc" },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        category: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ["STAFF", "ADMIN", "OWNER"] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      orderBy: { firstName: "asc" },
    }),
  ]);

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/appointments">
              <ArrowLeft className="h-4 w-4" />
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
            ...s,
            price: Number(s.price),
          }))}
          staff={staff}
        />
      </div>
    </DashboardLayout>
  );
}
