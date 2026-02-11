import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SalesTable } from "@/components/sales/sales-table";
import { getSales } from "@/lib/actions/sale";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function SalesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canCreate = hasPermission(userRole, "sales:create");

  const [salesResult, settingsResult] = await Promise.all([
    getSales({ page: 1, limit: 15 }),
    getSettings(),
  ]);

  if (!salesResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{salesResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const settings = settingsResult.success ? settingsResult.data : {
    currencySymbol: "$",
    timezone: "UTC",
  };

  const { sales, total, page, totalPages } = salesResult.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Sales</h1>
          <p className="text-muted-foreground">
            View and manage all sales transactions
          </p>
        </div>

        {/* Sales Table */}
        <SalesTable
          initialSales={sales}
          initialTotal={total}
          initialPage={page}
          initialTotalPages={totalPages}
          canCreate={canCreate}
          currencySymbol={settings.currencySymbol}
          timezone={settings.timezone}
          fetchSales={getSales}
        />
      </div>
    </DashboardLayout>
  );
}
