import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { formatInTz } from "@/lib/utils/timezone";
import { getSettings } from "@/lib/actions/settings";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  Edit,
  UserCheck,
  UserX,
  Briefcase,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StaffRecentAppointments } from "@/components/staff/staff-recent-appointments";
import { getUserById } from "@/lib/actions/user";
import { hasPermission, canManageRole } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { PasswordResetDialog } from "@/components/staff/password-reset-dialog";
import { UserPermissionsEditor } from "@/components/staff/user-permissions-editor";
import { getUserPermissionOverrides } from "@/lib/actions/permission";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("staff");

  const permUserId = actor.userId;
  if (!await hasPermission(userRoleId, "staff:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["staff:view"]);
  }

  const hasEditPermission = await hasPermission(userRoleId, "staff:update", isSuperAdmin, salonId, permUserId);
  const canManagePermissions = await hasPermission(userRoleId, "permissions:manage", isSuperAdmin, salonId, permUserId);

  const [result, settingsResult] = await Promise.all([
    getUserById(id),
    getSettings(),
  ]);
  const tz = settingsResult.success ? settingsResult.data.timezone : "UTC";
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  if (!result.success) {
    notFound();
  }

  const user = result.data;

  // Only show edit controls if the viewer outranks the viewed user
  const canManageThisUser = await canManageRole(userRoleId, user.roleDefinitionId ?? "", isSuperAdmin, salonId);
  const canEdit = hasEditPermission && canManageThisUser;
  // A user can always edit their own profile (name/email/phone; role + service-
  // provider are locked appropriately in the form).
  const isSelf = actor.userId === user.id;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/staff">
                <ArrowLeft className="h-5 w-5" />
                <span className="sr-only">Back to staff</span>
              </Link>
            </Button>
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-xl bg-purple-100 text-purple-600">
                {getInitials(user.firstName, user.lastName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold">
                  {user.firstName} {user.lastName}
                </h1>
                {user.isActive ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    <UserCheck className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <UserX className="h-3 w-3 mr-1" />
                    Inactive
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  className="border"
                  style={{
                    backgroundColor: `${user.roleColor}20`,
                    color: user.roleColor,
                    borderColor: `${user.roleColor}40`,
                  }}
                >
                  {user.roleLabel || user.role}
                </Badge>
                {user.isServiceProvider && (
                  <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                    Service Provider
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {(canEdit || isSelf) && (
            <div className="flex gap-2">
              {canEdit && (
                <PasswordResetDialog
                  userId={user.id}
                  userName={`${user.firstName} ${user.lastName}`}
                />
              )}
              <Button asChild>
                <Link href={`/dashboard/staff/${user.id}/edit`}>
                  <Edit className="h-4 w-4 mr-2" />
                  {isSelf && !canEdit ? "Edit Profile" : "Edit Staff"}
                </Link>
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Contact Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{user.email}</span>
              </div>
              {user.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{user.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>Joined {formatInTz(user.createdAt, "MMMM d, yyyy", tz)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span>Total Appointments</span>
                </div>
                <span className="font-bold">{user._count.appointments}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Total Sales</span>
                </div>
                <span className="font-bold">{user._count.sales}</span>
              </div>
            </CardContent>
          </Card>

          {/* Schedule Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Working Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {user.schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedule set</p>
              ) : (
                <div className="space-y-2">
                  {user.schedules
                    .filter((s) => s.isAvailable)
                    .map((schedule) => (
                      <div
                        key={schedule.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium">
                          {DAY_NAMES[schedule.dayOfWeek]}
                        </span>
                        <span className="text-muted-foreground">
                          {schedule.startTime} - {schedule.endTime}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Appointments */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Appointments</CardTitle>
            <CardDescription>Last 10 appointments handled by this staff member</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <StaffRecentAppointments appointments={user.appointments} timezone={tz} currencyCode={currencyCode} />
          </CardContent>
        </Card>
        {/* Permission Overrides (Owner/settings:manage only) */}
        {canManagePermissions && canManageThisUser && <UserPermissionsSection userId={user.id} />}
      </div>
    </>
  );
}

async function UserPermissionsSection({ userId }: { userId: string }) {
  const result = await getUserPermissionOverrides(userId);
  if (!result.success) return null;
  return <UserPermissionsEditor data={result.data} />;
}

