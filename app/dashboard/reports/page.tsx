import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ReportsCharts } from "@/components/reports/reports-charts";
import { BranchFilter } from "@/components/dashboard/branch-filter";
import { getReportData } from "@/lib/actions/dashboard";
import { getTimezone } from "@/lib/actions/settings";
import { getBranches } from "@/lib/actions/branch";
import { getMonthRange } from "@/lib/utils/timezone";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { user } = session;
  if (!user.salonRole && !user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const isOwner = userRole === "OWNER" || isSuperAdmin;

  // Check permission to view reports
  if (!hasPermission(userRole, "reports:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const params = await searchParams;
  const branchFilter = isOwner && params.branch === "all" ? "all" as const : "current" as const;

  // Get timezone first, then compute month range for initial report data
  const [tz, branchesResult] = await Promise.all([
    getTimezone(),
    isOwner ? getBranches() : Promise.resolve(null),
  ]);
  const { start: startDate, end: endDate } = getMonthRange(tz);
  const reportResult = await getReportData({ startDate, endDate, branchFilter });

  const hasMultipleBranches = branchesResult?.success && branchesResult.data.length > 1;
  const currentSalonName = branchesResult?.success
    ? branchesResult.data.find((b) => b.id === user.salonId)?.name
    : undefined;

  if (!reportResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="space-y-6">
          <div>
            <h2 className="text-3xl font-bold">Reports & Analytics</h2>
            <p className="text-muted-foreground mt-1">
              View business performance and insights
            </p>
          </div>
          <div className="p-6 text-center text-muted-foreground">
            {reportResult.error}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  async function handleDateRangeChange(startDate: Date, endDate: Date) {
    "use server";
    const result = await getReportData({ startDate, endDate, branchFilter });
    return result.success ? result.data : null;
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold">Reports & Analytics</h2>
            <p className="text-muted-foreground mt-1">
              View business performance and insights
            </p>
          </div>
          {hasMultipleBranches && (
            <BranchFilter
              currentFilter={branchFilter}
              currentSalonName={currentSalonName}
            />
          )}
        </div>

        <ReportsCharts
          initialData={reportResult.data}
          onDateRangeChange={handleDateRangeChange}
          timezone={tz}
        />
      </div>
    </DashboardLayout>
  );
}
