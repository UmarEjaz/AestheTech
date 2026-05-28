import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/categories/category-manager";
import { CategoryErrorState } from "@/components/categories/category-error-state";
import {
  getAllExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  toggleExpenseCategory,
  deleteExpenseCategory,
} from "@/lib/actions/expense-category";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function ExpenseCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId ?? null;

  const canView =
    isSuperAdmin ||
    (userRoleId != null && await hasPermission(userRoleId, "expense-categories:view", isSuperAdmin, salonId, session.user.id));
  if (!canView) {
    redirectAccessDenied(["expense-categories:view"]);
  }

  const canCreate =
    isSuperAdmin ||
    (userRoleId != null && await hasPermission(userRoleId, "expense-categories:create", isSuperAdmin, salonId, session.user.id));
  const canUpdate =
    isSuperAdmin ||
    (userRoleId != null && await hasPermission(userRoleId, "expense-categories:update", isSuperAdmin, salonId, session.user.id));
  const canDelete =
    isSuperAdmin ||
    (userRoleId != null && await hasPermission(userRoleId, "expense-categories:delete", isSuperAdmin, salonId, session.user.id));

  const result = await getAllExpenseCategories();
  if (!result.success) {
    return (
      <DashboardLayout isSuperAdmin={isSuperAdmin}>
        <CategoryErrorState
          title="Expense Categories"
          description="Manage expense categories for your organization"
          backHref="/dashboard/expenses"
          backLabel="Back to expenses"
          error={result.error}
        />
      </DashboardLayout>
    );
  }
  const categories = result.data;

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/expenses" aria-label="Back to expenses">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Expense Categories</h1>
            <p className="text-muted-foreground">
              Manage expense categories for your organization
            </p>
          </div>
        </div>

        <CategoryManager
          title="Expense Categories"
          countLabel="Expenses"
          categories={categories}
          namePlaceholder="e.g. Office Supplies"
          iconPlaceholder="e.g. Package"
          onCreate={canCreate ? createExpenseCategory : undefined}
          onUpdate={canUpdate ? updateExpenseCategory : undefined}
          onToggle={canUpdate ? toggleExpenseCategory : undefined}
          onDelete={canDelete ? deleteExpenseCategory : undefined}
        />
      </div>
    </DashboardLayout>
  );
}
