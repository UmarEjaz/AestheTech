"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { expenseCategorySchema, ExpenseCategoryInput } from "@/lib/validations/expense";
import { getOrgRootSalonId } from "./branch";
import { logAudit } from "./audit";

export type ExpenseCategoryItem = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count: { expenses: number };
};

const DEFAULT_CATEGORIES = [
  { name: "Rent", icon: "Building2", color: "#6366F1" },
  { name: "Utilities", icon: "Zap", color: "#F59E0B" },
  { name: "Supplies", icon: "Package", color: "#10B981" },
  { name: "Equipment", icon: "Wrench", color: "#8B5CF6" },
  { name: "Marketing", icon: "Megaphone", color: "#EC4899" },
  { name: "Insurance", icon: "Shield", color: "#3B82F6" },
  { name: "Salaries", icon: "Users", color: "#EF4444" },
  { name: "Training", icon: "GraduationCap", color: "#14B8A6" },
  { name: "Maintenance", icon: "Hammer", color: "#F97316" },
  { name: "Other", icon: "MoreHorizontal", color: "#6B7280" },
];

/**
 * Lazy-seed default categories for an organization if none exist.
 */
async function ensureDefaultCategories(orgRootSalonId: string): Promise<void> {
  const count = await prisma.expenseCategory.count({
    where: { salonId: orgRootSalonId },
  });

  if (count > 0) return;

  await prisma.expenseCategory.createMany({
    data: DEFAULT_CATEGORIES.map((cat) => ({
      salonId: orgRootSalonId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      isDefault: true,
    })),
    skipDuplicates: true,
  });
}

/**
 * Get all expense categories for the organization.
 */
export async function getAllExpenseCategories(): Promise<ActionResult<ExpenseCategoryItem[]>> {
  const authResult = await checkAuth("expense-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.expenseCategory.findMany({
      where: { salonId: orgRootId, deletedAt: null },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        isDefault: true,
        isActive: true,
        _count: { select: { expenses: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching expense categories:", error);
    return { success: false, error: "Failed to fetch expense categories" };
  }
}

/**
 * Get only active expense categories (for dropdowns).
 */
export async function getActiveExpenseCategories(): Promise<
  ActionResult<{ id: string; name: string; icon: string | null; color: string | null }[]>
> {
  const authResult = await checkAuth("expenses:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.expenseCategory.findMany({
      where: { salonId: orgRootId, isActive: true, deletedAt: null },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { name: "asc" },
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching active expense categories:", error);
    return { success: false, error: "Failed to fetch expense categories" };
  }
}

/**
 * Create a new expense category.
 */
export async function createExpenseCategory(
  data: ExpenseCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("expense-categories:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = expenseCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const category = await prisma.expenseCategory.create({
      data: {
        salonId: orgRootId,
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    await logAudit({
      action: "EXPENSE_CATEGORY_CREATED",
      entityType: "ExpenseCategory",
      entityId: category.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: { id: category.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error creating expense category:", error);
    return { success: false, error: "Failed to create expense category" };
  }
}

/**
 * Update an expense category.
 */
export async function updateExpenseCategory(
  id: string,
  data: ExpenseCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("expense-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = expenseCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    // Fetch existing for audit-log purposes only (we need the previous name)
    const existing = await prisma.expenseCategory.findFirst({
      where: { id, salonId: orgRootId, deletedAt: null },
      select: { name: true },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    // Atomic update: verification filters are part of the update itself,
    // so a race between the find above and the write here can't silently
    // change a category that no longer belongs to this org or got soft-deleted.
    const result = await prisma.expenseCategory.updateMany({
      where: { id, salonId: orgRootId, deletedAt: null },
      data: {
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    if (result.count === 0) {
      return { success: false, error: "Category not found" };
    }

    await logAudit({
      action: "EXPENSE_CATEGORY_UPDATED",
      entityType: "ExpenseCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name, previousName: existing.name },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: { id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error updating expense category:", error);
    return { success: false, error: "Failed to update expense category" };
  }
}

/**
 * Toggle an expense category's active status.
 */
export async function toggleExpenseCategory(
  id: string
): Promise<ActionResult<{ isActive: boolean }>> {
  const authResult = await checkAuth("expense-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const existing = await prisma.expenseCategory.findFirst({
      where: { id, salonId: orgRootId, deletedAt: null },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const updated = await prisma.expenseCategory.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await logAudit({
      action: updated.isActive ? "EXPENSE_CATEGORY_RESTORED" : "EXPENSE_CATEGORY_DEACTIVATED",
      entityType: "ExpenseCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: existing.name },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: { isActive: updated.isActive } };
  } catch (error) {
    console.error("Error toggling expense category:", error);
    return { success: false, error: "Failed to update expense category" };
  }
}

/**
 * Delete an expense category.
 * - Hard-deletes when no references exist anywhere (excluding audit logs).
 * - Soft-deletes (sets deletedAt) when only "other" references exist beyond Expenses.
 * - Blocks with an error if any Expense still references it (defense-in-depth — UI also disables).
 */
export async function deleteExpenseCategory(
  id: string
): Promise<ActionResult<{ hardDeleted: boolean }>> {
  const authResult = await checkAuth("expense-categories:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const existing = await prisma.expenseCategory.findFirst({
      where: { id, salonId: orgRootId, deletedAt: null },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const expensesCount = await prisma.expense.count({
      where: { categoryId: id },
    });
    if (expensesCount > 0) {
      return {
        success: false,
        error: `Cannot delete: ${expensesCount} expense(s) use this category. Deactivate it instead.`,
      };
    }

    // "Other references" check — defensive future-proofing.
    // No other tables currently reference ExpenseCategory.
    const otherReferencesCount = 0;

    const snapshot = {
      name: existing.name,
      icon: existing.icon,
      color: existing.color,
      isDefault: existing.isDefault,
      isActive: existing.isActive,
      createdAt: existing.createdAt,
    };

    let hardDeleted: boolean;
    if (otherReferencesCount > 0) {
      await prisma.expenseCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      hardDeleted = false;
    } else {
      await prisma.expenseCategory.delete({ where: { id } });
      hardDeleted = true;
    }

    await logAudit({
      action: "EXPENSE_CATEGORY_DELETED",
      entityType: "ExpenseCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { hardDeleted, snapshot },
    });

    revalidatePath("/dashboard/expenses");
    revalidatePath("/dashboard/expenses/categories");
    return { success: true, data: { hardDeleted } };
  } catch (error) {
    console.error("Error deleting expense category:", error);
    return { success: false, error: "Failed to delete expense category" };
  }
}
