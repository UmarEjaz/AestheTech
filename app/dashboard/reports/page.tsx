import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ReportsCharts } from "@/components/reports/reports-charts";
import { getReportData } from "@/lib/actions/dashboard";
import { getTimezone } from "@/lib/actions/settings";
import { startOfMonth, endOfMonth } from "date-fns";

export default async function ReportsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role as Role;

  // Check permission to view reports
  if (!hasPermission(userRole, "reports:view")) {
    redirect("/dashboard");
  }

  // Get initial report data for current month
  const startDate = startOfMonth(new Date());
  const endDate = endOfMonth(new Date());

  const [reportResult, tz] = await Promise.all([
    getReportData({ startDate, endDate }),
    getTimezone(),
  ]);

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
    const result = await getReportData({ startDate, endDate });
    return result.success ? result.data : null;
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Reports & Analytics</h2>
          <p className="text-muted-foreground mt-1">
            View business performance and insights
          </p>
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
