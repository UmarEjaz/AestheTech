import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InvoiceTable } from "@/components/invoices/invoice-table";
import { getInvoices, getInvoiceStats } from "@/lib/actions/invoice";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { formatCurrency } from "@/lib/utils/currency";

export default async function InvoicesPage() {
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
  await requireModule("invoices");
  const permUserId = actor.userId;
  if (!(await hasPermission(userRoleId, "invoices:view", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["invoices:view"]);
  }

  const [invoicesResult, statsResult, settingsResult] = await Promise.all([
    getInvoices({ page: 1, limit: 15 }),
    getInvoiceStats(),
    getSettings(),
  ]);

  const settings = settingsResult.success
    ? settingsResult.data
    : { currencyCode: "USD", timezone: "UTC" };

  if (!invoicesResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{invoicesResult.error}</p>
        </div>
      </>
    );
  }

  const { invoices, total, page, totalPages } = invoicesResult.data;
  const stats = statsResult.success
    ? statsResult.data
    : { totalPending: 0, totalOverdue: 0, pendingCount: 0, overdueCount: 0 };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground">
            View and manage all invoices for your salon
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending</p>
                <p className="mt-1 text-2xl font-bold">
                  {formatCurrency(stats.totalPending, settings.currencyCode)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.pendingCount} invoice{stats.pendingCount === 1 ? "" : "s"}
                </p>
              </div>
              <Clock className="h-5 w-5 text-amber-600" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Overdue</p>
                <p className="mt-1 text-2xl font-bold">
                  {formatCurrency(stats.totalOverdue, settings.currencyCode)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.overdueCount} invoice{stats.overdueCount === 1 ? "" : "s"}
                </p>
              </div>
              <AlertTriangle
                className={stats.overdueCount > 0 ? "h-5 w-5 text-destructive" : "h-5 w-5 text-muted-foreground"}
              />
            </CardContent>
          </Card>
        </div>

        {/* Invoice table */}
        <InvoiceTable
          initialInvoices={invoices}
          initialTotal={total}
          initialPage={page}
          initialTotalPages={totalPages}
          currencyCode={settings.currencyCode}
          timezone={settings.timezone}
          fetchInvoices={getInvoices}
        />
      </div>
    </>
  );
}
