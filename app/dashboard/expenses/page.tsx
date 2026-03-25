import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ExpenseSearch } from "@/components/expenses/expense-search";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpenseSummary } from "@/components/expenses/expense-summary";
import { getExpenses, getIncomeExpenseSummary } from "@/lib/actions/expense";
import { getActiveExpenseCategories } from "@/lib/actions/expense-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    startDate?: string;
    endDate?: string;
    page?: string;
  }>;
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!hasPermission(userRole, "expenses:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const canManage = hasPermission(userRole, "expenses:update", isSuperAdmin);
  const canDelete = hasPermission(userRole, "expenses:delete", isSuperAdmin);
  const canManageCategories = hasPermission(userRole, "expense-categories:manage", isSuperAdmin);

  const page = parseInt(params.page || "1", 10);
  const query = params.q || "";
  const categoryId = params.category || "";
  const startDate = params.startDate || undefined;
  const endDate = params.endDate || undefined;

  const [result, categoriesResult, settingsResult, summaryResult] = await Promise.all([
    getExpenses(
      {
        query: query || undefined,
        categoryId: categoryId || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        page,
        limit: 20,
      },
      "current"
    ),
    getActiveExpenseCategories(),
    getSettings(),
    getIncomeExpenseSummary(),
  ]);

  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const summary = summaryResult.success ? summaryResult.data : null;

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { expenses, total, totalPages } = result.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Expenses</h1>
            <p className="text-muted-foreground">
              Track and manage your salon expenses
            </p>
          </div>
          <div className="flex gap-2">
            {canManageCategories && (
              <Button variant="outline" asChild>
                <Link href="/dashboard/expenses/categories">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Categories
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild>
                <Link href="/dashboard/expenses/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Expense
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Income vs Expense Summary */}
        {summary && (
          <ExpenseSummary
            todayIncome={summary.todayIncome}
            todayExpenses={summary.todayExpenses}
            monthIncome={summary.monthIncome}
            monthExpenses={summary.monthExpenses}
            currencyCode={currencyCode}
          />
        )}

        {/* Search and Filters */}
        <ExpenseSearch categories={categories} />

        {/* Expense List */}
        <ExpenseList
          expenses={expenses}
          page={page}
          totalPages={totalPages}
          total={total}
          canManage={canManage}
          canDelete={canDelete}
          currencyCode={currencyCode}
        />
      </div>
    </DashboardLayout>
  );
}
