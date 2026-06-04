import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StaffForm } from "@/components/staff/staff-form";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function NewStaffPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!session.user.salonRole && !isSuperAdmin) {
    redirectAccessDenied();
  }
  const userRole = session.user.salonRole ?? null;
  const userRoleId = session.user.salonRoleId ?? null;

  const salonId = session.user.salonId;
  if (!(await hasPermission(userRoleId, "staff:create", isSuperAdmin, salonId, session.user.id))) {
    redirectAccessDenied(["staff:create"]);
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/staff">
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Back to staff</span>
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
        <StaffForm mode="create" currentUserRole={userRole} isSuperAdmin={isSuperAdmin} />
      </div>
    </>
  );
}
