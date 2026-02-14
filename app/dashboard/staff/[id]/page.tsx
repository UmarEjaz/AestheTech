import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { formatInTz } from "@/lib/utils/timezone";
import { getTimezone } from "@/lib/actions/settings";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  Shield,
  Edit,
  UserCheck,
  UserX,
  Briefcase,
  Clock,
} from "lucide-react";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUserById } from "@/lib/actions/user";
import { hasPermission } from "@/lib/permissions";
import { PasswordResetDialog } from "@/components/staff/password-reset-dialog";

const ROLE_COLORS: Record<Role, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  OWNER: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  ADMIN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  STAFF: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  RECEPTIONIST: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER: "Owner",
  ADMIN: "Admin",
  STAFF: "Staff",
  RECEPTIONIST: "Receptionist",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  CONFIRMED: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  IN_PROGRESS: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

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
  const userRole = session.user.role as Role;

  if (!hasPermission(userRole, "staff:view")) {
    redirect("/dashboard");
  }

  const canEdit = hasPermission(userRole, "staff:update");

  const [result, tz] = await Promise.all([getUserById(id), getTimezone()]);

  if (!result.success) {
    notFound();
  }

  const user = result.data;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
  };

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/staff">
                <ArrowLeft className="h-5 w-5" />
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
              <Badge className={`mt-1 ${ROLE_COLORS[user.role]}`}>
                <Shield className="h-3 w-3 mr-1" />
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <PasswordResetDialog
                userId={user.id}
                userName={`${user.firstName} ${user.lastName}`}
              />
              <Button asChild>
                <Link href={`/dashboard/staff/${user.id}/edit`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Staff
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.appointments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No appointments yet
                    </TableCell>
                  </TableRow>
                ) : (
                  user.appointments.map((appointment) => (
                    <TableRow key={appointment.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {formatInTz(appointment.startTime, "MMM d, yyyy", tz)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {formatInTz(appointment.startTime, "h:mm a", tz)} -{" "}
                            {formatInTz(appointment.endTime, "h:mm a", tz)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {appointment.client.firstName} {appointment.client.lastName}
                          {appointment.client.isWalkIn && (
                            <Badge variant="outline" className="text-xs">
                              Walk-in
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{appointment.service.name}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[appointment.status] || "bg-gray-100"}>
                          {appointment.status.toLowerCase().replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
