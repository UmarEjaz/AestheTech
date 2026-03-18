import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { getBranchDetail } from "@/lib/actions/branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Phone, Mail, ArrowLeft } from "lucide-react";
import { BranchStaffTable } from "./branch-staff-table";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface BranchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function BranchDetailPage({ params }: BranchDetailPageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect("/login");

  const userRole = session.user.salonRole as Role;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  if (!hasPermission(userRole, "branches:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const result = await getBranchDetail(id);

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole} isSuperAdmin={isSuperAdmin}>
        <div className="space-y-6">
          <p className="text-destructive">{result.error}</p>
          <Link href="/dashboard/branches">
            <Button variant="outline">Back to Branches</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const branch = result.data;
  const canManage = hasPermission(userRole, "branches:manage", isSuperAdmin);

  return (
    <DashboardLayout userRole={userRole} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/branches">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{branch.name}</h1>
              <Badge variant={branch.isActive ? "default" : "secondary"}>
                {branch.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-muted-foreground">Branch details and staff management</p>
          </div>
        </div>

        {/* Branch Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Branch Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {branch.address && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{branch.address}</span>
              </div>
            )}
            {branch.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{branch.phone}</span>
              </div>
            )}
            {branch.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span>{branch.email}</span>
              </div>
            )}
            {!branch.address && !branch.phone && !branch.email && (
              <p className="text-muted-foreground">No contact information provided.</p>
            )}
          </CardContent>
        </Card>

        {/* Staff Table */}
        <BranchStaffTable
          branchId={branch.id}
          staff={branch.staff}
          canManage={canManage}
        />
      </div>
    </DashboardLayout>
  );
}
