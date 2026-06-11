import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { ClientTable } from "@/components/clients/client-table";
import { getClients } from "@/lib/actions/client";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function ClientsPage() {
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
  if (!await hasPermission(userRoleId, "clients:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["clients:view"]);
  }
  const canCreate = await hasPermission(userRoleId, "clients:create", isSuperAdmin, salonId, permUserId);
  const canEdit = await hasPermission(userRoleId, "clients:update", isSuperAdmin, salonId, permUserId);
  const canDelete = await hasPermission(userRoleId, "clients:delete", isSuperAdmin, salonId, permUserId);

  const [clientsResult, settingsResult] = await Promise.all([
    getClients({ page: 1, limit: 15 }),
    getSettings(),
  ]);
  const loyaltyEnabled = settingsResult.success ? settingsResult.data.loyaltyProgramEnabled : true;
  const timezone = settingsResult.success ? settingsResult.data.timezone : "UTC";

  if (!clientsResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{clientsResult.error}</p>
        </div>
      </>
    );
  }

  const { clients, total, page, totalPages } = clientsResult.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Clients</h1>
          <p className="text-muted-foreground">
            Manage your salon&apos;s client database
          </p>
        </div>

        {/* Client Table with Search */}
        <ClientTable
          initialClients={clients}
          initialTotal={total}
          initialPage={page}
          initialTotalPages={totalPages}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          loyaltyEnabled={loyaltyEnabled}
          timezone={timezone}
          fetchClients={getClients}
        />
      </div>
    </>
  );
}
