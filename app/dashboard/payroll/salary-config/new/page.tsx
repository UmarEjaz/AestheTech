import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SalaryConfigForm } from "@/components/payroll/salary-config-form";
import { getBranchStaff } from "@/lib/actions/salary-config";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function NewSalaryConfigPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  await requireModule("payroll");
  if (!(await hasPermission(userRoleId, "salary-config:create", isSuperAdmin, salonId, session.user.id))) {
    redirectAccessDenied(["salary-config:create"]);
  }

  const [staffResult, settingsResult] = await Promise.all([
    getBranchStaff(),
    getSettings(),
  ]);

  const staff = staffResult.success ? staffResult.data : [];
  const staffLoadFailed = !staffResult.success;
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/payroll/salary-config">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to salary config</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add Salary Configuration</h1>
            <p className="text-muted-foreground">
              Set up pay rate for a staff member
            </p>
          </div>
        </div>

        {staffLoadFailed && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20 p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              Failed to load staff list. Please go back and try again.
            </p>
          </div>
        )}

        <SalaryConfigForm mode="create" staff={staff} currencyCode={currencyCode} />
      </div>
    </>
  );
}
