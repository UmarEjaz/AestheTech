import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ startTime?: string }>;
}

export default async function NewAppointmentPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const userRole = session.user.role as Role;
  const canCreate = hasPermission(userRole, "appointments:create");

  if (!canCreate) {
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

  // Parse initial date from URL if provided
  const initialDate = params.startTime ? new Date(params.startTime) : undefined;

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
            <h1 className="text-3xl font-bold">Book Appointment</h1>
            <p className="text-muted-foreground">
              Schedule a new appointment
            </p>
          </div>
        </div>

        <AppointmentForm
          mode="create"
          clients={clients}
          services={services.map((s) => ({
            ...s,
            price: Number(s.price),
          }))}
          staff={staff}
          initialDate={initialDate}
        />
      </div>
    </DashboardLayout>
  );
}
