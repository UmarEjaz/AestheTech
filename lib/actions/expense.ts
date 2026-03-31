"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseSearchSchema,
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseSearchParams,
} from "@/lib/validations/expense";
import { getOrgRootSalonId, getOrganizationSalonIds } from "./branch";
import { logAudit } from "./audit";
import { getSettings } from "./settings";
import { getTodayRange, getMonthRange, formatInTz, getNow } from "@/lib/utils/timezone";
import { endOfMonth, startOfMonth } from "date-fns";

export type ExpenseListItem = {
  id: string;
  amount: Prisma.Decimal;
  description: string | null;
  date: Date;
  receiptUrl: string | null;
  isRecurring: boolean;
  createdAt: Date;
  category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  };
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
  salon: {
    id: string;
    name: string;
  };
};

const expenseSelect = {
  id: true,
  amount: true,
  description: true,
  date: true,
  receiptUrl: true,
  isRecurring: true,
  createdAt: true,
  category: {
    select: { id: true, name: true, icon: true, color: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  salon: {
    select: { id: true, name: true },
  },
} satisfies Prisma.ExpenseSelect;

/**
 * Get expenses with filtering, pagination, and search.
 * Owners see all branches when branchFilter is "all".
 */
export async function getExpenses(
  params: ExpenseSearchParams = {},
  branchFilter: "current" | "all" = "current"
): Promise<
  ActionResult<{
    expenses: ExpenseListItem[];
    total: number;
    page: number;
    totalPages: number;
  }>
> {
  const authResult = await checkAuth("expenses:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = expenseSearchSchema.safeParse(params);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { query, categoryId, startDate, endDate, isRecurring, page = 1, limit = 20 } = validation.data;

  try {
    const isOwnerOrSuperAdmin = authResult.role === "OWNER" || authResult.isSuperAdmin;

    let salonIds: string[];
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      salonIds = await getOrganizationSalonIds(authResult.salonId);
    } else {
      salonIds = [authResult.salonId];
    }

    const where: Prisma.ExpenseWhereInput = {
      salonId: { in: salonIds },
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    if (isRecurring !== undefined) {
      where.isRecurring = isRecurring;
    }

    if (query) {
      where.description = { contains: query, mode: "insensitive" };
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: { date: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      success: true,
      data: {
        expenses: expenses as ExpenseListItem[],
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching expenses:", error);
    return { success: false, error: "Failed to fetch expenses" };
  }
}

/**
 * Get a single expense by ID.
 */
export async function getExpense(id: string): Promise<ActionResult<ExpenseListItem>> {
  const authResult = await checkAuth("expenses:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const expense = await prisma.expense.findFirst({
      where: { id, salonId: { in: salonIds } },
      select: expenseSelect,
    });

    if (!expense) {
      return { success: false, error: "Expense not found" };
    }

    return { success: true, data: expense as ExpenseListItem };
  } catch (error) {
    console.error("Error fetching expense:", error);
    return { success: false, error: "Failed to fetch expense" };
  }
}

/**
 * Create a new expense.
 */
export async function createExpense(
  data: CreateExpenseInput
): Promise<ActionResult<ExpenseListItem>> {
  const authResult = await checkAuth("expenses:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = createExpenseSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { categoryId, amount, description, date, receiptUrl, isRecurring } = validation.data;

  try {
    // Verify category belongs to this org
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    const category = await prisma.expenseCategory.findFirst({
      where: { id: categoryId, salonId: orgRootId, isActive: true },
    });

    if (!category) {
      return { success: false, error: "Invalid expense category" };
    }

    const expense = await prisma.expense.create({
      data: {
        salonId: authResult.salonId,
        categoryId,
        amount,
        description: description || null,
        date,
        receiptUrl: receiptUrl || null,
        isRecurring,
        createdById: authResult.userId,
      },
      select: expenseSelect,
    });

    await logAudit({
      action: "EXPENSE_CREATED",
      entityType: "Expense",
      entityId: expense.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { amount, category: category.name, date: date.toISOString() },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: expense as ExpenseListItem };
  } catch (error) {
    console.error("Error creating expense:", error);
    return { success: false, error: "Failed to create expense" };
  }
}

/**
 * Update an existing expense.
 */
export async function updateExpense(
  data: UpdateExpenseInput
): Promise<ActionResult<ExpenseListItem>> {
  const authResult = await checkAuth("expenses:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = updateExpenseSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { id, categoryId, amount, description, date, receiptUrl, isRecurring } = validation.data;

  try {
    // Verify expense belongs to the user's accessible salons
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];
    const existing = await prisma.expense.findFirst({
      where: { id, salonId: { in: salonIds } },
      include: { category: { select: { name: true } } },
    });

    if (!existing) {
      return { success: false, error: "Expense not found" };
    }

    // If category is being changed, verify the new one belongs to this org
    if (categoryId) {
      const orgRootId = await getOrgRootSalonId(authResult.salonId);
      const category = await prisma.expenseCategory.findFirst({
        where: { id: categoryId, salonId: orgRootId, isActive: true },
      });
      if (!category) {
        return { success: false, error: "Invalid expense category" };
      }
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(categoryId !== undefined && { categoryId }),
        ...(amount !== undefined && { amount }),
        ...(description !== undefined && { description: description || null }),
        ...(date !== undefined && { date }),
        ...(receiptUrl !== undefined && { receiptUrl: receiptUrl || null }),
        ...(isRecurring !== undefined && { isRecurring }),
      },
      select: expenseSelect,
    });

    await logAudit({
      action: "EXPENSE_UPDATED",
      entityType: "Expense",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: {
        previousAmount: existing.amount.toString(),
        newAmount: amount?.toString(),
        previousCategory: existing.category.name,
      },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: expense as ExpenseListItem };
  } catch (error) {
    console.error("Error updating expense:", error);
    return { success: false, error: "Failed to update expense" };
  }
}

/**
 * Delete an expense (OWNER only).
 */
export async function deleteExpense(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("expenses:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    const existing = await prisma.expense.findFirst({
      where: { id, salonId: { in: orgSalonIds } },
      include: { category: { select: { name: true } } },
    });

    if (!existing) {
      return { success: false, error: "Expense not found" };
    }

    await prisma.expense.delete({ where: { id } });

    await logAudit({
      action: "EXPENSE_DELETED",
      entityType: "Expense",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: {
        amount: existing.amount.toString(),
        category: existing.category.name,
        date: existing.date.toISOString(),
      },
    });

    revalidatePath("/dashboard/expenses");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting expense:", error);
    return { success: false, error: "Failed to delete expense" };
  }
}

/**
 * Get today's and this month's income vs expenses for the summary widget.
 */
export async function getIncomeExpenseSummary(): Promise<
  ActionResult<{
    todayIncome: number;
    todayExpenses: number;
    monthIncome: number;
    monthExpenses: number;
  }>
> {
  const authResult = await checkAuth("expenses:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const settingsResult = await getSettings();
    const tz = settingsResult.success ? settingsResult.data.timezone : "UTC";

    // Timezone-adjusted DateTime ranges for sales (createdAt is a full timestamp)
    const { start: todayStart, end: todayEnd } = getTodayRange(tz);
    const { start: monthStart, end: monthEnd } = getMonthRange(tz);

    // Date-only boundaries for expenses (date is @db.Date — stored as midnight UTC)
    const todayStr = formatInTz(new Date(), "yyyy-MM-dd", tz);
    const expTodayDate = new Date(todayStr + "T00:00:00Z");

    const now = getNow(tz);
    const expMonthStart = new Date(
      formatInTz(startOfMonth(now), "yyyy-MM-dd", tz) + "T00:00:00Z"
    );
    const expMonthEnd = new Date(
      formatInTz(endOfMonth(now), "yyyy-MM-dd", tz) + "T00:00:00Z"
    );

    const salonId = authResult.salonId;

    const [todaySales, todayExpenses, monthSales, monthExpenses] = await Promise.all([
      prisma.sale.findMany({
        where: {
          salonId,
          createdAt: { gte: todayStart, lt: todayEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),
      prisma.expense.findMany({
        where: {
          salonId,
          date: { equals: expTodayDate },
        },
        select: { amount: true },
      }),
      prisma.sale.findMany({
        where: {
          salonId,
          createdAt: { gte: monthStart, lte: monthEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),
      prisma.expense.findMany({
        where: {
          salonId,
          date: { gte: expMonthStart, lte: expMonthEnd },
        },
        select: { amount: true },
      }),
    ]);

    return {
      success: true,
      data: {
        todayIncome: todaySales.reduce((sum, s) => sum + Number(s.finalAmount), 0),
        todayExpenses: todayExpenses.reduce((sum, e) => sum + Number(e.amount), 0),
        monthIncome: monthSales.reduce((sum, s) => sum + Number(s.finalAmount), 0),
        monthExpenses: monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0),
      },
    };
  } catch (error) {
    console.error("Error fetching income/expense summary:", error);
    return { success: false, error: "Failed to fetch summary" };
  }
}
