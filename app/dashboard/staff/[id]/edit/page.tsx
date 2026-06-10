import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StaffForm } from "@/components/staff/staff-form";
import { Button } from "@/components/ui/button";
import { getUserById } from "@/lib/actions/user";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function EditStaffPage({
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
  const userRole = session.user.salonRole ?? null;
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  const salonId = session.user.salonId;
  await requireModule("staff");
  if (!(await hasPermission(userRoleId, "staff:update", isSuperAdmin, salonId, session.user.id))) {
    redirectAccessDenied(["staff:update"]);
  }

  const result = await getUserById(id);

  if (!result.success) {
    notFound();
  }

  const user = result.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/staff/${id}`}>
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Back to staff details</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Staff Member</h1>
            <p className="text-muted-foreground">
              Update {user.firstName} {user.lastName}&apos;s information
            </p>
          </div>
        </div>

        {/* Form */}
        <StaffForm
          user={{
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isActive: user.isActive,
            isServiceProvider: user.isServiceProvider,
          }}
          mode="edit"
          currentUserRole={userRole}
          isSuperAdmin={isSuperAdmin}
        />
      </div>
    </>
  );
}
