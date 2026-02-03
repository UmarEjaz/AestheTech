import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function SettingsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canView = hasPermission(userRole, "settings:view");
  const canManage = hasPermission(userRole, "settings:manage");

  if (!canView) {
    redirect("/dashboard");
  }

  const result = await getSettings();

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your salon settings and preferences
          </p>
        </div>

        <SettingsForm settings={result.data} canManage={canManage} />
      </div>
    </DashboardLayout>
  );
}
