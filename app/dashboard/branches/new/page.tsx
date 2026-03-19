import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { BranchForm } from "./branch-form";

export default async function NewBranchPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  if (!hasPermission(userRole, "branches:manage", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  return (
    <DashboardLayout userRole={userRole} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Branch</h1>
          <p className="text-muted-foreground">
            Add a new location to your salon organization
          </p>
        </div>
        <BranchForm />
      </div>
    </DashboardLayout>
  );
}
