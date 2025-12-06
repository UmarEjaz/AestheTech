import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import {
  ArrowLeft,
  Edit,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Gift,
  Clock,
  DollarSign,
  AlertTriangle,
  Heart,
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { getClient } from "@/lib/actions/client";
import { hasPermission } from "@/lib/permissions";

interface PageProps {
  params: Promise<{ id: string }>;
}

const tierColors = {
  SILVER: "bg-gray-400",
  GOLD: "bg-yellow-500",
  PLATINUM: "bg-purple-500",
};

export default async function ClientDetailPage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const userRole = session.user.role as Role;
  const canEdit = hasPermission(userRole, "clients:update");

  const result = await getClient(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const client = result.data;
  const initials = `${client.firstName[0]}${client.lastName[0]}`.toUpperCase();

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/clients">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-3xl font-bold">
                {client.firstName} {client.lastName}
              </h1>
              <div className="flex items-center gap-4 text-muted-foreground mt-1">
                <div className="flex items-center gap-1">
                  <Phone className="h-4 w-4" />
                  {client.phone}
                </div>
                {client.email && (
                  <div className="flex items-center gap-1">
                    <Mail className="h-4 w-4" />
                    {client.email}
                  </div>
                )}
              </div>
            </div>
          </div>
          {canEdit && (
            <Button asChild>
              <Link href={`/dashboard/clients/${client.id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
          )}
        </div>

        {/* Tags */}
        {client.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {client.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Appointments</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{client.appointments.length}</div>
              <p className="text-xs text-muted-foreground">Total visits</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                $
                {client.sales
                  .reduce((sum, sale) => sum + Number(sale.finalAmount), 0)
                  .toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">Lifetime value</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Loyalty Points</CardTitle>
              <Gift className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">
                  {client.loyaltyPoints?.balance || 0}
                </span>
                {client.loyaltyPoints && (
                  <span
                    className={`h-3 w-3 rounded-full ${tierColors[client.loyaltyPoints.tier]}`}
                    title={client.loyaltyPoints.tier}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {client.loyaltyPoints?.tier || "SILVER"} tier
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Member Since</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {format(new Date(client.createdAt), "MMM yyyy")}
              </div>
              <p className="text-xs text-muted-foreground">
                {format(new Date(client.createdAt), "PP")}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Client Information */}
          <Card>
            <CardHeader>
              <CardTitle>Client Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {client.birthday && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Birthday</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(client.birthday), "MMMM d, yyyy")}
                    </p>
                  </div>
                </div>
              )}

              {client.address && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Address</p>
                    <p className="text-sm text-muted-foreground">{client.address}</p>
                  </div>
                </div>
              )}

              {client.preferences && (
                <>
                  <Separator />
                  <div className="flex gap-3">
                    <Heart className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Preferences</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {client.preferences}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {client.allergies && (
                <>
                  <Separator />
                  <div className="flex gap-3">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">
                        Allergies / Sensitivities
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {client.allergies}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {client.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {client.notes}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Appointments */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Appointments</CardTitle>
            </CardHeader>
            <CardContent>
              {client.appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No appointments yet</p>
              ) : (
                <div className="space-y-4">
                  {client.appointments.slice(0, 5).map((appointment) => (
                    <div
                      key={appointment.id}
                      className="flex items-center justify-between border-b pb-3 last:border-0"
                    >
                      <div>
                        <p className="font-medium">{appointment.service.name}</p>
                        <p className="text-sm text-muted-foreground">
                          with {appointment.staff.firstName} {appointment.staff.lastName}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {format(new Date(appointment.startTime), "MMM d, yyyy")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(appointment.startTime), "h:mm a")}
                        </p>
                        <Badge
                          variant={
                            appointment.status === "COMPLETED"
                              ? "success"
                              : appointment.status === "CANCELLED"
                              ? "destructive"
                              : "secondary"
                          }
                          className="mt-1"
                        >
                          {appointment.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {client.sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet</p>
            ) : (
              <div className="space-y-4">
                {client.sales.slice(0, 5).map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between border-b pb-3 last:border-0"
                  >
                    <div>
                      <p className="font-medium">
                        {sale.items.map((item) => item.service.name).join(", ")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(sale.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">${Number(sale.finalAmount).toFixed(2)}</p>
                      {Number(sale.discount) > 0 && (
                        <p className="text-xs text-green-600">
                          -${Number(sale.discount).toFixed(2)} discount
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
