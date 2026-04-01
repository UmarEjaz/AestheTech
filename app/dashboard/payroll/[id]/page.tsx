import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PayrollEntryTable } from "@/components/payroll/payroll-entry-table";
import { PayrollRunActions } from "./payroll-run-actions";
import { getPayrollRun } from "@/lib/actions/payroll";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils/currency";
import { formatInTz } from "@/lib/utils/timezone";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PayrollRunDetailPage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!hasPermission(userRole, "payroll:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const { id } = await params;
  const canManage = hasPermission(userRole, "payroll:manage", isSuperAdmin);
  const canPay = hasPermission(userRole, "payroll:pay", isSuperAdmin);

  const [result, settingsResult] = await Promise.all([
    getPayrollRun(id),
    getSettings(),
  ]);

  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";
  const timezone = settingsResult.success ? settingsResult.data.timezone : "UTC";

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
          <Button asChild className="mt-4">
            <Link href="/dashboard/payroll">Back to Payroll</Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const run = result.data;

  const statusColors: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    FINALIZED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PAID: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/payroll">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to payroll</span>
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">Payroll Run</h1>
                <Badge className={statusColors[run.status] || ""}>
                  {run.status}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {formatInTz(run.periodStart, "MMM d", timezone)} -{" "}
                {formatInTz(run.periodEnd, "MMM d, yyyy", timezone)} | {run.salon.name}
              </p>
            </div>
          </div>

          <PayrollRunActions
            runId={run.id}
            status={run.status}
            canManage={canManage}
            canPay={canPay}
          />
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Base Pay</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(Number(run.totalBasePay), currencyCode)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Bonuses</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                +{formatCurrency(Number(run.totalBonus), currencyCode)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Deductions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                -{formatCurrency(Number(run.totalDeductions), currencyCode)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Net Pay</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">
                {formatCurrency(Number(run.totalNetPay), currencyCode)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Run notes */}
        {run.notes && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{run.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Paid info */}
        {run.paidAt && (
          <p className="text-sm text-muted-foreground">
            Paid on {formatInTz(run.paidAt, "MMM d, yyyy 'at' h:mm a", timezone)} by{" "}
            {run.createdBy.firstName} {run.createdBy.lastName}
          </p>
        )}

        {/* Entries Table */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Staff Entries</h2>
          <PayrollEntryTable
            entries={run.entries}
            runStatus={run.status}
            currencyCode={currencyCode}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
