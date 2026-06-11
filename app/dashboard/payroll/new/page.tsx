import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PayrollRunForm } from "@/components/payroll/payroll-run-form";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function NewPayrollRunPage() {
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
  await requireModule("payroll");
  const permUserId = actor.userId;
  if (!(await hasPermission(userRoleId, "payroll:create", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["payroll:create"]);
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/payroll">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to payroll</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">New Payroll Run</h1>
            <p className="text-muted-foreground">
              Create a new payroll run for the current branch
            </p>
          </div>
        </div>

        <PayrollRunForm />
      </div>
    </>
  );
}
