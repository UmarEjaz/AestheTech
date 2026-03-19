import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { getBranches } from "@/lib/actions/branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Phone, Mail, Users } from "lucide-react";

export default async function BranchesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole as Role;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  if (!hasPermission(userRole, "branches:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const result = await getBranches();
  const branches = result.success ? result.data : [];

  return (
    <DashboardLayout userRole={userRole} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Branches</h1>
            <p className="text-muted-foreground">
              Manage your salon locations
            </p>
          </div>
          {hasPermission(userRole, "branches:manage", isSuperAdmin) && (
            <Link href="/dashboard/branches/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Branch
              </Button>
            </Link>
          )}
        </div>

        {branches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground text-center">
                No branches found. Create your first branch to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {branches.map((branch) => (
              <Link key={branch.id} href={`/dashboard/branches/${branch.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{branch.name}</CardTitle>
                      <Badge variant={branch.isActive ? "default" : "secondary"}>
                        {branch.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    {branch.address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{branch.address}</span>
                      </div>
                    )}
                    {branch.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 flex-shrink-0" />
                        <span>{branch.phone}</span>
                      </div>
                    )}
                    {branch.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{branch.email}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Users className="h-4 w-4 flex-shrink-0" />
                      <span>{branch._count.users} staff member{branch._count.users !== 1 ? "s" : ""}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
