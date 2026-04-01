import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { PayrollRunList } from "@/components/payroll/payroll-run-list";
import { PayrollSummaryCards } from "@/components/payroll/payroll-summary-cards";
import { PayrollSearch } from "@/components/payroll/payroll-search";
import { getPayrollRuns, getPayrollSummary } from "@/lib/actions/payroll";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { PayrollRunStatus } from "@prisma/client";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: string;
  }>;
}

export default async function PayrollPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!hasPermission(userRole, "payroll:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const canManage = hasPermission(userRole, "payroll:manage", isSuperAdmin);
  const canDelete = hasPermission(userRole, "payroll:delete", isSuperAdmin);

  const page = parseInt(params.page || "1", 10);
  const status = params.status as PayrollRunStatus | undefined;
  const startDate = params.startDate || undefined;
  const endDate = params.endDate || undefined;

  const [result, summaryResult, settingsResult] = await Promise.all([
    getPayrollRuns(
      {
        status: status && Object.values(PayrollRunStatus).includes(status) ? status : undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        page,
        limit: 20,
      },
      "current"
    ),
    getPayrollSummary("current"),
    getSettings(),
  ]);

  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";
  const timezone = settingsResult.success ? settingsResult.data.timezone : "UTC";
  const summary = summaryResult.success ? summaryResult.data : null;

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { runs, total, totalPages } = result.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Payroll</h1>
            <p className="text-muted-foreground">
              Manage staff salaries and payroll runs
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/payroll/salary-config">
                <Settings2 className="mr-2 h-4 w-4" />
                Salary Config
              </Link>
            </Button>
            {canManage && (
              <Button asChild>
                <Link href="/dashboard/payroll/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Payroll Run
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <PayrollSummaryCards summary={summary} currencyCode={currencyCode} />
        )}

        {/* Search and Filters */}
        <PayrollSearch />

        {/* Payroll Run List */}
        <PayrollRunList
          runs={runs}
          page={page}
          totalPages={totalPages}
          total={total}
          canManage={canManage}
          canDelete={canDelete}
          currencyCode={currencyCode}
          timezone={timezone}
        />
      </div>
    </DashboardLayout>
  );
}
