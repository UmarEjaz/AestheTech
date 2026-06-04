import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SalesTable } from "@/components/sales/sales-table";
import { getSales, getTodaysSalesSummary } from "@/lib/actions/sale";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function SalesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  if (!await hasPermission(userRoleId, "sales:view", isSuperAdmin, salonId, session.user.id)) {
    redirectAccessDenied(["sales:view"]);
  }
  const canCreate = await hasPermission(userRoleId, "sales:create", isSuperAdmin, salonId, session.user.id);

  const [salesResult, settingsResult, todaySummaryResult] = await Promise.all([
    getSales({ page: 1, limit: 15 }),
    getSettings(),
    getTodaysSalesSummary(),
  ]);

  if (!salesResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{salesResult.error}</p>
        </div>
      </>
    );
  }

  const settings = settingsResult.success ? settingsResult.data : {
    currencyCode: "USD",
    timezone: "UTC",
  };

  const { sales, total, page, totalPages } = salesResult.data;
  const todaySummary = todaySummaryResult.success
    ? todaySummaryResult.data
    : { count: 0, revenue: 0, averageTicket: 0 };

  return (
    <>
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
          currencyCode={settings.currencyCode}
          timezone={settings.timezone}
          fetchSales={getSales}
          todaysSalesCount={todaySummary.count}
          todaysRevenue={todaySummary.revenue}
        />
      </div>
    </>
  );
}
