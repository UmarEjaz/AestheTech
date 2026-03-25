import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { getActiveExpenseCategories } from "@/lib/actions/expense-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function NewExpensePage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.salonRole;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const canCreate =
    isSuperAdmin ||
    (userRole != null && hasPermission(userRole as Role, "expenses:create"));

  if (!canCreate) {
    redirect("/dashboard/access-denied");
  }

  const [categoriesResult, settingsResult] = await Promise.all([
    getActiveExpenseCategories(),
    getSettings(),
  ]);
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/expenses">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add New Expense</h1>
            <p className="text-muted-foreground">
              Record a new business expense
            </p>
          </div>
        </div>

        <ExpenseForm mode="create" categories={categories} currencyCode={currencyCode} />
      </div>
    </DashboardLayout>
  );
}
