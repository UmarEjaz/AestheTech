import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/clients/client-form";
import { getClient } from "@/lib/actions/client";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: PageProps) {
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
  const salonId = actor.salonId;
  await requireModule("clients");
  const permUserId = actor.userId;
  const canEdit = await hasPermission(userRoleId, "clients:update", isSuperAdmin, salonId, permUserId);

  if (!canEdit) {
    redirectAccessDenied(["clients:update"]);
  }

  const result = await getClient(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const client = result.data;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/clients/${id}`}>
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to client details</span>
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
            photoUrl: client.photoUrl,
            birthday: client.birthday,
            address: client.address,
            notes: client.notes,
            preferences: client.preferences,
            allergies: client.allergies,
            tags: client.tags,
          }}
        />
      </div>
    </>
  );
}
