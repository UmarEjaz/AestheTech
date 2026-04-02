import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { SalaryConfigList } from "@/components/payroll/salary-config-list";
import { getSalaryConfigs } from "@/lib/actions/salary-config";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function SalaryConfigPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!hasPermission(userRole, "salary-config:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const canManage = hasPermission(userRole, "salary-config:manage", isSuperAdmin);

  const [result, settingsResult] = await Promise.all([
    getSalaryConfigs("current"),
    getSettings(),
  ]);

  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/payroll">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to payroll</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Salary Configuration</h1>
              <p className="text-muted-foreground">
                Configure pay rates for staff members
              </p>
            </div>
          </div>
          {canManage && (
            <Button asChild>
              <Link href="/dashboard/payroll/salary-config/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Configuration
              </Link>
            </Button>
          )}
        </div>

        <SalaryConfigList
          configs={result.data}
          canManage={canManage}
          currencyCode={currencyCode}
        />
      </div>
    </DashboardLayout>
  );
}
