import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  const canView = await hasPermission(userRole, "settings:view", isSuperAdmin, salonId, session.user.id);
  const canManage = await hasPermission(userRole, "settings:manage", isSuperAdmin, salonId, session.user.id);

  if (!canView) {
    redirect("/dashboard/access-denied");
  }

  const result = await getSettings();

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Manage your salon settings and preferences
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Link href="/dashboard/settings/roles">
                <Button variant="outline">
                  <Users className="h-4 w-4 mr-2" />
                  Manage Roles
                </Button>
              </Link>
              <Link href="/dashboard/settings/permissions">
                <Button variant="outline">
                  <Shield className="h-4 w-4 mr-2" />
                  Permissions
                </Button>
              </Link>
            </div>
          )}
        </div>

        <SettingsForm settings={result.data} canManage={canManage} />
      </div>
    </DashboardLayout>
  );
}
