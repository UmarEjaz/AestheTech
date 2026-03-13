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

function roleBadgeVariant(role: string) {
  switch (role) {
    case "OWNER":
      return "default" as const;
    case "ADMIN":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

interface SalonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SalonDetailPage({ params }: SalonDetailPageProps) {
  const session = await auth();

  if (!session?.user?.isSuperAdmin) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getSalonById(id);

  if (!result.success) {
    return (
      <div className="min-h-screen bg-background">
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
      </div>
    );
  }

  const salon = result.data;

  return (
    <div className="min-h-screen bg-background">
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
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(salon.subscriptionStatus)}>
              {salon.subscriptionStatus}
            </Badge>
            {!salon.isActive && (
              <Badge variant="destructive">Inactive</Badge>
            )}
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

          {/* Members */}
          <Card>
            <CardHeader>
              <CardTitle>
                Members ({salon.members.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {salon.members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No members in this salon yet.
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salon.members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {member.user.firstName} {member.user.lastName}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {member.user.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant={roleBadgeVariant(member.role)}>
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {member.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="destructive">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {new Date(member.createdAt).toLocaleDateString()}
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
    </div>
  );
}
