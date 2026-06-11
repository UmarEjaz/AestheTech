import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { BranchForm } from "./branch-form";

export default async function NewBranchPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;

  const salonId = actor.salonId;
  await requireModule("branches");
  const permUserId = actor.userId;
  if (!(await hasPermission(userRoleId, "branches:create", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["branches:create"]);
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Branch</h1>
          <p className="text-muted-foreground">
            Add a new location to your salon organization
          </p>
        </div>
        <BranchForm />
      </div>
    </>
  );
}
