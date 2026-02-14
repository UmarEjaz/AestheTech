import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Users, DollarSign, Scissors, Clock, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardWidgets } from "@/components/dashboard/dashboard-widgets";
import { getDashboardStats } from "@/lib/actions/dashboard";
import { getTimezone } from "@/lib/actions/settings";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

export default async function DashboardPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role as Role;
  const canViewReports = hasPermission(userRole, "reports:view");

  const [statsResult, tz] = await Promise.all([getDashboardStats(), getTimezone()]);

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold">Welcome back, {user.firstName}!</h2>
            <p className="text-muted-foreground mt-1">
              Here&apos;s what&apos;s happening at your salon today.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/dashboard/appointments/new">
                <Calendar className="h-4 w-4 mr-2" />
                New Appointment
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/sales/new">
                <DollarSign className="h-4 w-4 mr-2" />
                New Sale
              </Link>
            </Button>
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
    </DashboardLayout>
  );
}
