import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { isModuleEnabled } from "@/lib/actions/modules";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  const permUserId = actor.userId;
  const canView = await hasPermission(userRoleId, "settings:view", isSuperAdmin, salonId, permUserId);
  const canManage = await hasPermission(userRoleId, "settings:manage", isSuperAdmin, salonId, permUserId);
  const canManageRoles = await hasPermission(userRoleId, "roles:manage", isSuperAdmin, salonId, permUserId);
  const canManagePermissions = await hasPermission(userRoleId, "permissions:manage", isSuperAdmin, salonId, permUserId);

  if (!canView) {
    redirectAccessDenied(["settings:view"]);
  }

  // Roles & Permissions is an independently toggleable module. Effective super
  // admins ("Enter salon") always see it; otherwise respect the salon's toggle.
  const rolesModuleEnabled =
    isSuperAdmin || !salonId || (await isModuleEnabled(salonId, "roles"));

  const result = await getSettings();

  if (!result.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Manage your salon settings and preferences
            </p>
          </div>
          {rolesModuleEnabled && (canManageRoles || canManagePermissions) && (
            <Link href="/dashboard/settings/roles">
              <Button variant="outline">
                <Shield className="h-4 w-4 mr-2" />
                Roles & Permissions
              </Button>
            </Link>
          )}
        </div>

        <SettingsForm settings={result.data} canManage={canManage} />
      </div>
    </>
  );
}
