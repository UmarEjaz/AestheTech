import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSalonById } from "@/lib/actions/salon";
import Link from "next/link";
import { ArrowLeft, Building2, Mail, Phone, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SalonImpersonationActions } from "@/components/admin/salon-impersonation-actions";
import { UserImpersonationAction } from "@/components/admin/user-impersonation-action";
import { SalonModuleToggles } from "@/components/admin/salon-module-toggles";
import { SalonStaffLimit } from "@/components/admin/salon-staff-limit";
import { getSalonModuleStates } from "@/lib/actions/modules";
import { getStaffUsage } from "@/lib/actions/staff-cap";
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

const DEFAULT_ROLE_COLOR = "#6B7280"; // gray, for users with no role assigned

interface SalonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SalonDetailPage({ params }: SalonDetailPageProps) {
  const session = await auth();

  if (!session?.user?.isPlatformAdmin) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [result, moduleStates, staffUsage] = await Promise.all([
    getSalonById(id),
    getSalonModuleStates(id),
    getStaffUsage(id),
  ]);

  if (!result.success) {
    return (
      <div className="container mx-auto max-w-4xl p-4 md:p-8">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href="/admin/salons">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Salons
            </Link>
          </Button>
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{result.error}</p>
            </CardContent>
          </Card>
        </div>
    );
  }

  const salon = result.data;

  return (
    <div className="container mx-auto max-w-4xl p-4 md:p-8">
        {/* Back nav */}
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/admin/salons">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Salons
          </Link>
        </Button>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
                <Building2 className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{salon.name}</h1>
                <p className="text-muted-foreground font-mono text-sm">
                  {salon.slug}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(salon.subscriptionStatus)}>
                {salon.subscriptionStatus}
              </Badge>
              {!salon.isActive && (
                <Badge variant="destructive">Inactive</Badge>
              )}
            </div>
            <SalonImpersonationActions
              salonId={salon.id}
              salonName={salon.name}
              variant="detail"
              disabled={!salon.isActive}
            />
          </div>
        </div>

        <div className="grid gap-6">
          {/* Salon Info */}
          <Card>
            <CardHeader>
              <CardTitle>Salon Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {salon.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span>{salon.email}</span>
                  </div>
                )}
                {salon.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span>{salon.phone}</span>
                  </div>
                )}
                {salon.address && (
                  <div className="flex items-center gap-2 text-sm sm:col-span-2">
                    <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span>{salon.address}</span>
                  </div>
                )}
                {!salon.email && !salon.phone && !salon.address && (
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    No contact information provided.
                  </p>
                )}
              </div>

              <Separator className="my-4" />

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="font-medium">
                    {salon.subscriptionPlan ?? "None"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expires</p>
                  <p className="font-medium">
                    {salon.subscriptionExpiresAt
                      ? new Date(salon.subscriptionExpiresAt).toLocaleDateString()
                      : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {new Date(salon.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Staff seats */}
          <Card>
            <CardHeader>
              <CardTitle>Staff Seats</CardTitle>
            </CardHeader>
            <CardContent>
              <SalonStaffLimit
                salonId={salon.id}
                initialLimit={staffUsage.limit}
                used={staffUsage.used}
              />
            </CardContent>
          </Card>

          {/* Modules */}
          <Card>
            <CardHeader>
              <CardTitle>Modules</CardTitle>
            </CardHeader>
            <CardContent>
              {moduleStates.success ? (
                <SalonModuleToggles
                  salonId={salon.id}
                  initial={moduleStates.data}
                  disabled={!salon.isActive}
                />
              ) : (
                <p className="text-sm text-destructive">{moduleStates.error}</p>
              )}
            </CardContent>
          </Card>

          {/* Staff */}
          <Card>
            <CardHeader>
              <CardTitle>
                Staff ({salon.users.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {salon.users.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No staff in this salon yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="hidden md:table-cell">Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Joined</TableHead>
                      <TableHead className="text-right">Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salon.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.firstName} {user.lastName}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className="border"
                            style={{
                              backgroundColor: `${user.roleColor ?? DEFAULT_ROLE_COLOR}20`,
                              color: user.roleColor ?? DEFAULT_ROLE_COLOR,
                              borderColor: `${user.roleColor ?? DEFAULT_ROLE_COLOR}40`,
                            }}
                          >
                            {user.roleName ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {user.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="destructive">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <UserImpersonationAction
                            salonId={salon.id}
                            userId={user.id}
                            userName={`${user.firstName} ${user.lastName}`}
                            disabled={!salon.isActive || !user.isActive}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
  );
}
