import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Users,
  UserCircle,
  DollarSign,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  TrendingUp,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlatformStats } from "@/lib/actions/salon";
import { formatCurrency } from "@/lib/utils/currency";

// Platform display currency (tenants may use their own; this is the rollup view).
const PLATFORM_CURRENCY = "USD";

function statusVariant(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "TRIAL":
      return "warning" as const;
    case "SUSPENDED":
    case "CANCELLED":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    redirect("/dashboard");
  }

  const result = await getPlatformStats();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl p-4 md:p-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Platform Overview</h1>
            <p className="mt-1 text-muted-foreground">
              Welcome back, {session.user.firstName}. Here&apos;s how AestheTech is doing across all salons.
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/salons">
              <Building2 className="mr-2 h-4 w-4" />
              Manage Salons
            </Link>
          </Button>
        </div>

        {!result.success ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{result.error}</p>
            </CardContent>
          </Card>
        ) : (
          (() => {
            const s = result.data;
            return (
              <div className="space-y-6">
                {/* Primary metric cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard
                    title="Total Salons"
                    icon={<Building2 className="h-4 w-4" />}
                    value={s.totalSalons.toLocaleString()}
                    sub={`${s.activeSalons} active · ${s.inactiveSalons} inactive`}
                    accent="text-violet-600"
                  />
                  <MetricCard
                    title="Tenant Users"
                    icon={<Users className="h-4 w-4" />}
                    value={s.totalUsers.toLocaleString()}
                    sub={`+${s.newUsersThisMonth} this month`}
                    accent="text-blue-600"
                  />
                  <MetricCard
                    title="Total Clients"
                    icon={<UserCircle className="h-4 w-4" />}
                    value={s.totalClients.toLocaleString()}
                    sub="Across all salons"
                    accent="text-emerald-600"
                  />
                  <MetricCard
                    title="Revenue (30d)"
                    icon={<DollarSign className="h-4 w-4" />}
                    value={formatCurrency(s.salesLast30dRevenue, PLATFORM_CURRENCY)}
                    sub={`${s.salesLast30dCount.toLocaleString()} sales · platform rollup`}
                    accent="text-green-600"
                  />
                </div>

                {/* Secondary row: growth, activity, support */}
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Tenant growth */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <TrendingUp className="h-4 w-4 text-violet-600" />
                        Tenant Growth
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Row label="New salons this month" value={`+${s.newSalonsThisMonth}`} />
                      <Row label="Organizations (root)" value={s.rootSalons.toLocaleString()} />
                      <Row label="Branches" value={s.branchSalons.toLocaleString()} />
                      <Row label="Active rate" value={
                        s.totalSalons > 0
                          ? `${Math.round((s.activeSalons / s.totalSalons) * 100)}%`
                          : "—"
                      } />
                    </CardContent>
                  </Card>

                  {/* Activity (30d) */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="h-4 w-4 text-blue-600" />
                        Activity (last 30 days)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Row label="Sales recorded" value={s.salesLast30dCount.toLocaleString()} />
                      <Row
                        label="Revenue"
                        value={formatCurrency(s.salesLast30dRevenue, PLATFORM_CURRENCY)}
                      />
                      <Row label="Appointments booked" value={s.appointmentsLast30d.toLocaleString()} />
                      <Row
                        label="Avg sale value"
                        value={
                          s.salesLast30dCount > 0
                            ? formatCurrency(s.salesLast30dRevenue / s.salesLast30dCount, PLATFORM_CURRENCY)
                            : "—"
                        }
                      />
                    </CardContent>
                  </Card>

                  {/* Support / impersonation */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="h-4 w-4 text-amber-600" />
                        Support Access
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Row
                        label="Active sessions now"
                        value={
                          <span className={s.activeImpersonationSessions > 0 ? "text-amber-600 font-semibold" : ""}>
                            {s.activeImpersonationSessions}
                          </span>
                        }
                      />
                      <Row label="Sessions (30d)" value={s.impersonationsLast30d.toLocaleString()} />
                      <div className="pt-1">
                        <Button asChild variant="outline" size="sm" className="w-full">
                          <Link href="/admin/salons">
                            Enter a salon
                            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Subscriptions breakdown */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Subscription Status</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatPill label="Active" value={s.subscriptionStatus.active} variant="success" />
                      <StatPill label="Trial" value={s.subscriptionStatus.trial} variant="warning" />
                      <StatPill label="Suspended" value={s.subscriptionStatus.suspended} variant="destructive" />
                      <StatPill label="Cancelled" value={s.subscriptionStatus.cancelled} variant="secondary" />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Subscription Plans</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatPill label="Basic" value={s.subscriptionPlan.basic} variant="secondary" />
                      <StatPill label="Pro" value={s.subscriptionPlan.pro} variant="success" />
                      <StatPill label="Enterprise" value={s.subscriptionPlan.enterprise} variant="warning" />
                      <StatPill label="No plan" value={s.subscriptionPlan.none} variant="secondary" />
                    </CardContent>
                  </Card>
                </div>

                {/* Recently added salons */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-base">Recently Added Salons</CardTitle>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/admin/salons">
                        View all
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {s.recentSalons.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="text-muted-foreground">No salons yet.</p>
                        <Button asChild className="mt-4">
                          <Link href="/admin/salons/new">
                            <Plus className="mr-2 h-4 w-4" />
                            Create your first salon
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden sm:table-cell">Plan</TableHead>
                            <TableHead className="hidden md:table-cell">Staff</TableHead>
                            <TableHead className="hidden lg:table-cell">Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {s.recentSalons.map((salon) => (
                            <TableRow key={salon.id}>
                              <TableCell>
                                <Link
                                  href={`/admin/salons/${salon.id}`}
                                  className="font-medium text-primary hover:underline"
                                >
                                  {salon.name}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant={statusVariant(salon.subscriptionStatus)}>
                                  {salon.subscriptionStatus}
                                </Badge>
                                {!salon.isActive && (
                                  <Badge variant="destructive" className="ml-1">
                                    Inactive
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {salon.subscriptionPlan ?? (
                                  <span className="text-muted-foreground">--</span>
                                )}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">{salon.userCount}</TableCell>
                              <TableCell className="hidden lg:table-cell text-muted-foreground">
                                {new Date(salon.createdAt).toLocaleDateString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  icon,
  value,
  sub,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <span className={accent ?? "text-muted-foreground"}>{icon}</span>
        </div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatPill({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "warning" | "destructive" | "secondary";
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <div className="text-2xl font-bold">{value}</div>
      <Badge variant={variant} className="mt-1">
        {label}
      </Badge>
    </div>
  );
}
