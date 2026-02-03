import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/clients/client-form";
import { getClient } from "@/lib/actions/client";
import { hasPermission } from "@/lib/permissions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const userRole = session.user.role as Role;
  const canEdit = hasPermission(userRole, "clients:update");

  if (!canEdit) {
    redirect(`/dashboard/clients/${id}`);
  }

  const result = await getClient(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const client = result.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/clients/${id}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Client</h1>
            <p className="text-muted-foreground">
              Update {client.firstName}{client.lastName ? ` ${client.lastName}` : ""}{client.isWalkIn ? " (Walk-in)" : ""}&apos;s profile
            </p>
          </div>
        </div>

        <ClientForm
          mode="edit"
          client={{
            id: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            phone: client.phone,
            birthday: client.birthday,
            address: client.address,
            notes: client.notes,
            preferences: client.preferences,
            allergies: client.allergies,
            tags: client.tags,
          }}
        />
      </div>
    </DashboardLayout>
  );
}
