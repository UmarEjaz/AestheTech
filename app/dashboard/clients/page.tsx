import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ClientTable } from "@/components/clients/client-table";
import { getClients } from "@/lib/actions/client";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function ClientsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canCreate = hasPermission(userRole, "clients:create");
  const canEdit = hasPermission(userRole, "clients:update");
  const canDelete = hasPermission(userRole, "clients:delete");

  const [clientsResult, settingsResult] = await Promise.all([
    getClients({ page: 1, limit: 15 }),
    getSettings(),
  ]);
  const loyaltyEnabled = settingsResult.success ? settingsResult.data.loyaltyProgramEnabled : true;
  const timezone = settingsResult.success ? settingsResult.data.timezone : "UTC";

  if (!clientsResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{clientsResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { clients, total, page, totalPages } = clientsResult.data;

  return (
    <DashboardLayout userRole={userRole}>
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
    </DashboardLayout>
  );
}
