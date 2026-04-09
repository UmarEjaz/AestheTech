import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { getPermissionMatrix } from "@/lib/actions/permission";
import { PermissionsMatrix } from "@/components/settings/permissions-matrix";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function PermissionsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.salonRole ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  const canManage = await hasPermission(userRole, "settings:manage", isSuperAdmin, salonId, session.user.id);
  if (!canManage) {
    redirect("/dashboard/access-denied");
  }

  const result = await getPermissionMatrix();

  if (!result.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Roles & Permissions</h1>
            <p className="text-muted-foreground">
              Customize what each role can access in your salon
            </p>
          </div>
        </div>

        <PermissionsMatrix data={result.data} />
      </div>
    </DashboardLayout>
  );
}
