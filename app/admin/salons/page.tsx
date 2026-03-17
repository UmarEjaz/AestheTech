import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSalons } from "@/lib/actions/salon";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
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

export default async function AdminSalonsPage() {
  const session = await auth();

  if (!session?.user?.isSuperAdmin) {
    redirect("/dashboard");
  }

  const result = await getSalons();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl p-4 md:p-8">
        {/* Back nav + header */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Salon Management</h1>
              <p className="text-muted-foreground mt-1">
                View and manage all salons on the platform
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/salons/new">
                <Plus className="h-4 w-4 mr-2" />
                Create Salon
              </Link>
            </Button>
          </div>
        </div>

        {/* Content */}
        {!result.success ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{result.error}</p>
            </CardContent>
          </Card>
        ) : result.data.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No salons have been created yet.
              </p>
              <Button asChild className="mt-4">
                <Link href="/admin/salons/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first salon
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                All Salons ({result.data.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Plan</TableHead>
                    <TableHead className="hidden md:table-cell">Staff</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.map((salon) => (
                    <TableRow key={salon.id}>
                      <TableCell>
                        <Link
                          href={`/admin/salons/${salon.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {salon.name}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground font-mono text-sm">
                        {salon.slug}
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
                      <TableCell className="hidden md:table-cell">
                        {salon.subscriptionPlan ?? (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {salon._count.users}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">
                        {new Date(salon.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
