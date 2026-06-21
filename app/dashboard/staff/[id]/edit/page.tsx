import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StaffForm } from "@/components/staff/staff-form";
import { Button } from "@/components/ui/button";
import { getUserById } from "@/lib/actions/user";
import { hasPermission, canManageRole } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { SYSTEM_ROLES } from "@/lib/roles";

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
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;

  const salonId = actor.salonId;
  await requireModule("staff");
  const permUserId = actor.userId;
  // Self-edit is allowed even without staff:update (you can always edit your own
  // profile). Require staff:update only when editing someone else.
  const isSelf = actor.userId === id;
  if (!isSelf && !(await hasPermission(userRoleId, "staff:update", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["staff:update"]);
  }

  const result = await getUserById(id);

  if (!result.success) {
    notFound();
  }

  const user = result.data;

  // Hierarchy guard: you can only edit someone ranked below you — unless it's
  // your own profile (self-edit is always allowed for name/email/phone). Block
  // here at load so users never reach a form they can't actually save.
  if (!isSelf && !(await canManageRole(userRoleId, user.roleDefinitionId ?? "", isSuperAdmin, salonId))) {
    redirectAccessDenied(
      undefined,
      user.role === SYSTEM_ROLES.OWNER
        ? "The owner's profile can only be edited by the owner."
        : "You can only edit staff members whose role is below your own."
    );
  }

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
            roleDefinitionId: user.roleDefinitionId,
            isActive: user.isActive,
            isServiceProvider: user.isServiceProvider,
          }}
          mode="edit"
          currentUserRole={userRole}
          isSuperAdmin={isSuperAdmin}
          isSelf={isSelf}
        />
      </div>
    </>
  );
}
