import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { getExpense } from "@/lib/actions/expense";
import { getAllExpenseCategories } from "@/lib/actions/expense-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditExpensePage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("expenses");
  if (!isSuperAdmin) {
    // hasPermission applies :view inference, so :update implicitly grants :view —
    // no need to check :view explicitly.
    const permUserId = actor.userId;
    const canUpdate = await hasPermission(userRoleId, "expenses:update", isSuperAdmin, salonId, permUserId);
    if (!canUpdate) {
      redirectAccessDenied(["expenses:update"]);
    }
  }

  const { id } = await params;

  const [expenseResult, categoriesResult, settingsResult] = await Promise.all([
    getExpense(id),
    getAllExpenseCategories(),
    getSettings(),
  ]);

  if (!expenseResult.success) {
    redirect("/dashboard/expenses");
  }

  if (!categoriesResult.success || !settingsResult.success) {
    const errorMsg = !categoriesResult.success
      ? categoriesResult.error
      : settingsResult.success
        ? undefined
        : settingsResult.error;
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{errorMsg || "Failed to load required data"}</p>
        </div>
      </>
    );
  }

  // Pass id/name/icon/color/isActive so the form can pin the expense's current category
  // at the top and hide other inactive ones. See ExpenseForm for the dropdown rendering.
  const categories = categoriesResult.data.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    isActive: c.isActive,
  }));
  const currencyCode = settingsResult.data.currencyCode;

  const expense = expenseResult.data;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/expenses" aria-label="Back to expenses">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Expense</h1>
            <p className="text-muted-foreground">
              Update expense details
            </p>
          </div>
        </div>

        <ExpenseForm
          mode="edit"
          expense={{
            id: expense.id,
            categoryId: expense.category.id,
            amount: Number(expense.amount),
            description: expense.description,
            date: expense.date,
            receiptUrl: expense.receiptUrl,
            isRecurring: expense.isRecurring,
          }}
          categories={categories}
          currencyCode={currencyCode}
        />
      </div>
    </>
  );
}
