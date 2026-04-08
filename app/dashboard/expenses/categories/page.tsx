import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/expenses/category-manager";
import { getExpenseCategories } from "@/lib/actions/expense-category";
import { hasPermission } from "@/lib/permissions";

export default async function ExpenseCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.salonRole;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const canManage =
    isSuperAdmin ||
    (userRole != null && hasPermission(userRole, "expense-categories:manage"));

  if (!canManage) {
    redirect("/dashboard/access-denied");
  }

  const result = await getExpenseCategories();
  const categories = result.success ? result.data : [];

  return (
    <DashboardLayout>
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

        <CategoryManager categories={categories} />
      </div>
    </DashboardLayout>
  );
}
