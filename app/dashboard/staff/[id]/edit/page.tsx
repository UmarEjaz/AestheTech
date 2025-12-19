import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { StaffForm } from "@/components/staff/staff-form";
import { Button } from "@/components/ui/button";
import { getUserById } from "@/lib/actions/user";
import { hasPermission } from "@/lib/permissions";

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
  const userRole = session.user.role as Role;

  if (!hasPermission(userRole, "staff:update")) {
    redirect("/dashboard/staff");
  }

  const result = await getUserById(id);

  if (!result.success) {
    notFound();
  }

  const user = result.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/dashboard/staff/${id}`}>
              <ArrowLeft className="h-5 w-5" />
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
          }}
          mode="edit"
          currentUserRole={userRole}
        />
      </div>
    </DashboardLayout>
  );
}
