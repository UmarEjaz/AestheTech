import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Users, DollarSign, Scissors, Clock, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardWidgets } from "@/components/dashboard/dashboard-widgets";
import { BranchFilter } from "@/components/dashboard/branch-filter";
import { getDashboardStats } from "@/lib/actions/dashboard";
import { getDisabledModulesForSalon } from "@/lib/actions/modules";
import { getTimezone } from "@/lib/actions/settings";
import { getBranches } from "@/lib/actions/branch";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function DashboardPage({
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
    redirectAccessDenied();
  }
  const userRoleId = user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = user.salonId;
  const [rawCanViewReports, rawCanCreateAppointments, rawCanCreateSales, rawCanCreateClients, rawCanManageServices, rawCanViewSchedules, canViewAllBranches] = await Promise.all([
    hasPermission(userRoleId, "reports:view", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "appointments:create", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "sales:create", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "clients:create", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "services:create", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "schedules:view", isSuperAdmin, salonId, user.id),
    hasPermission(userRoleId, "data:all-branches", isSuperAdmin, salonId, user.id),
  ]);

  // Hide quick-action buttons for modules disabled for this salon (effective
  // super admin "Enter salon" bypasses). Keeps the always-on Dashboard tidy.
  const disabledModules = isSuperAdmin || !salonId
    ? new Set<string>()
    : new Set(await getDisabledModulesForSalon(salonId));
  const canViewReports = rawCanViewReports && !disabledModules.has("reports");
  const canCreateAppointments = rawCanCreateAppointments && !disabledModules.has("appointments");
  const canCreateSales = rawCanCreateSales && !disabledModules.has("sales");
  const canCreateClients = rawCanCreateClients && !disabledModules.has("clients");
  const canManageServices = rawCanManageServices && !disabledModules.has("services");
  const canViewSchedules = rawCanViewSchedules && !disabledModules.has("schedules");

  const params = await searchParams;
  const branchFilter = canViewAllBranches && params.branch === "all" ? "all" as const : "current" as const;

  const [statsResult, tz, branchesResult] = await Promise.all([
    getDashboardStats({ branchFilter }),
    getTimezone(),
    canViewAllBranches ? getBranches() : Promise.resolve(null),
  ]);

  const hasMultipleBranches = branchesResult?.success && branchesResult.data.length > 1;
  const currentSalonName = branchesResult?.success
    ? branchesResult.data.find((b) => b.id === user.salonId)?.name
    : undefined;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold">Welcome back, {user.firstName}!</h2>
            <p className="text-muted-foreground mt-1">
              Here&apos;s what&apos;s happening at your salon today.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasMultipleBranches && (
              <BranchFilter
                currentFilter={branchFilter}
                currentSalonName={currentSalonName}
              />
            )}
            {canCreateAppointments && (
            <Button asChild>
              <Link href="/dashboard/appointments/new">
                <Calendar className="h-4 w-4 mr-2" />
                New Appointment
              </Link>
            </Button>
            )}
            {canCreateSales && (
            <Button variant="outline" asChild>
              <Link href="/dashboard/sales/new">
                <DollarSign className="h-4 w-4 mr-2" />
                New Sale
              </Link>
            </Button>
            )}
          </div>
        </div>

        {/* Dashboard Widgets with Real Data */}
        {statsResult.success ? (
          <DashboardWidgets stats={statsResult.data} timezone={tz} />
        ) : (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">{statsResult.error}</p>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <div>
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {canCreateClients && (
            <Link href="/dashboard/clients/new">
              <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-purple-600" />
                    Add Client
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Register a new client
                  </p>
                </CardContent>
              </Card>
            </Link>
            )}

            {canManageServices && (
            <Link href="/dashboard/services/new">
              <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Scissors className="h-5 w-5 text-purple-600" />
                    Add Service
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Create a new service
                  </p>
                </CardContent>
              </Card>
            </Link>
            )}

            {canViewSchedules && (
            <Link href="/dashboard/schedules">
              <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-5 w-5 text-purple-600" />
                    Staff Schedules
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Manage working hours
                  </p>
                </CardContent>
              </Card>
            </Link>
            )}

            {canViewReports && (
              <Link href="/dashboard/reports">
                <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="h-5 w-5 text-purple-600" />
                      View Reports
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Analytics & insights
                    </p>
                  </CardContent>
                </Card>
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
