import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/clients/client-form";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function NewClientPage() {
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
  await requireModule("clients");
  const permUserId = actor.userId;
  const canCreate = await hasPermission(userRoleId, "clients:create", isSuperAdmin, salonId, permUserId);

  if (!canCreate) {
    redirectAccessDenied(["clients:create"]);
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/clients">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to clients</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add New Client</h1>
            <p className="text-muted-foreground">
              Create a new client profile
            </p>
          </div>
        </div>

        <ClientForm mode="create" />
      </div>
    </>
  );
}
