import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { StaffForm } from "@/components/staff/staff-form";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";

export default async function NewStaffPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;

  if (!hasPermission(userRole, "staff:create")) {
    redirect("/dashboard/access-denied");
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/staff">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add New Staff Member</h1>
            <p className="text-muted-foreground">
              Create a new account for a staff member
            </p>
          </div>
        </div>

        {/* Form */}
        <StaffForm mode="create" currentUserRole={userRole} />
      </div>
    </DashboardLayout>
  );
}
