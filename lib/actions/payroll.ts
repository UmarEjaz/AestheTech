"use server";

import { revalidatePath } from "next/cache";
import { Prisma, PayrollRunStatus, PayrollEntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import {
  createPayrollRunSchema,
  updatePayrollEntrySchema,
  payrollSearchSchema,
  CreatePayrollRunInput,
  UpdatePayrollEntryInput,
  PayrollSearchParams,
} from "@/lib/validations/payroll";
import { getOrganizationSalonIds, getOrgRootSalonId } from "./branch";
import { logAudit } from "./audit";
import { invalidateDashboardCache } from "@/lib/redis";

// Types

export type PayrollRunListItem = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  totalBasePay: Prisma.Decimal;
  totalBonus: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  totalNetPay: Prisma.Decimal;
  notes: string | null;
  paidAt: Date | null;
  createdAt: Date;
  _count: { entries: number };
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

export type PayrollRunDetail = PayrollRunListItem & {
  entries: PayrollEntryItem[];
};

export type PayrollEntryItem = {
  id: string;
  basePay: Prisma.Decimal;
  bonus: Prisma.Decimal;
  deductions: Prisma.Decimal;
  deductionNotes: string | null;
  netPay: Prisma.Decimal;
  status: PayrollEntryStatus;
  notes: string | null;
  paidAt: Date | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
};

export type PayrollSummary = {
  totalPayrollThisMonth: number;
  totalStaff: number;
  pendingRuns: number;
  avgSalary: number;
};

const payrollRunListSelect = {
  id: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  totalBasePay: true,
  totalBonus: true,
  totalDeductions: true,
  totalNetPay: true,
  notes: true,
  paidAt: true,
  createdAt: true,
  _count: { select: { entries: true } },
  createdBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  salon: {
    select: { id: true, name: true },
  },
} satisfies Prisma.PayrollRunSelect;

/**
 * Get payroll runs with filtering and pagination.
 */
export async function getPayrollRuns(
  params: PayrollSearchParams = {},
  branchFilter: "current" | "all" = "current"
): Promise<
  ActionResult<{
    runs: PayrollRunListItem[];
    total: number;
    page: number;
    totalPages: number;
  }>
> {
  const authResult = await checkAuth("payroll:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = payrollSearchSchema.safeParse(params);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { status, startDate, endDate, page = 1, limit = 20 } = validation.data;

  try {
    const isOwnerOrSuperAdmin = authResult.role === "OWNER" || authResult.isSuperAdmin;

    let salonIds: string[];
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      salonIds = await getOrganizationSalonIds(authResult.salonId);
    } else {
      salonIds = [authResult.salonId];
    }

    const where: Prisma.PayrollRunWhereInput = {
      salonId: { in: salonIds },
    };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.periodStart = {};
      if (startDate) where.periodStart.gte = startDate;
      if (endDate) where.periodStart.lte = endDate;
    }

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where,
        select: payrollRunListSelect,
        orderBy: { periodStart: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payrollRun.count({ where }),
    ]);

    return {
      success: true,
      data: {
        runs: runs as PayrollRunListItem[],
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching payroll runs:", error);
    return { success: false, error: "Failed to fetch payroll runs" };
  }
}

/**
 * Get a single payroll run with all entries.
 */
export async function getPayrollRun(id: string): Promise<ActionResult<PayrollRunDetail>> {
  const authResult = await checkAuth("payroll:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const run = await prisma.payrollRun.findFirst({
      where: { id, salonId: { in: salonIds } },
      select: {
        ...payrollRunListSelect,
        entries: {
          select: {
            id: true,
            basePay: true,
            bonus: true,
            deductions: true,
            deductionNotes: true,
            netPay: true,
            status: true,
            notes: true,
            paidAt: true,
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
          orderBy: { user: { firstName: "asc" } },
        },
      },
    });

    if (!run) {
      return { success: false, error: "Payroll run not found" };
    }

    return { success: true, data: run as PayrollRunDetail };
  } catch (error) {
    console.error("Error fetching payroll run:", error);
    return { success: false, error: "Failed to fetch payroll run" };
  }
}

/**
 * Create a new payroll run. Auto-populates entries from salary configs.
 */
export async function createPayrollRun(
  data: CreatePayrollRunInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("payroll:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = createPayrollRunSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { periodStart, periodEnd, notes } = validation.data;

  try {
    const run = await prisma.$transaction(async (tx) => {
      // Check for duplicate
      const existing = await tx.payrollRun.findUnique({
        where: {
          salonId_periodStart_periodEnd: {
            salonId: authResult.salonId,
            periodStart,
            periodEnd,
          },
        },
      });

      if (existing) {
        throw new Error("A payroll run already exists for this period at this branch");
      }

      // Get all active staff at this branch
      const activeStaff = await tx.userSalon.findMany({
        where: { salonId: authResult.salonId, isActive: true },
        select: { userId: true },
      });

      if (activeStaff.length === 0) {
        throw new Error("No active staff members found at this branch");
      }

      // Find most recent salary config for each staff in a single query
      const staffIds = activeStaff.map((s) => s.userId);
      const allConfigs = await tx.salaryConfig.findMany({
        where: {
          salonId: authResult.salonId,
          userId: { in: staffIds },
          isActive: true,
          effectiveDate: { lte: periodEnd },
        },
        orderBy: { effectiveDate: "desc" },
      });

      // Group by userId, take first (most recent due to desc order) per user
      const configByUser = new Map<string, number>();
      for (const config of allConfigs) {
        if (!configByUser.has(config.userId)) {
          configByUser.set(config.userId, Number(config.baseRate));
        }
      }

      const entries: { userId: string; basePay: number }[] = [];
      for (const [userId, basePay] of configByUser) {
        entries.push({ userId, basePay });
      }

      if (entries.length === 0) {
        throw new Error("No salary configurations found for any staff member. Please set up salary configs first.");
      }

      // Calculate totals
      const totalBasePay = entries.reduce((sum, e) => sum + e.basePay, 0);

      // Create run with entries
      const newRun = await tx.payrollRun.create({
        data: {
          salonId: authResult.salonId,
          periodStart,
          periodEnd,
          status: "DRAFT",
          totalBasePay,
          totalBonus: 0,
          totalDeductions: 0,
          totalNetPay: totalBasePay,
          notes: notes || null,
          createdById: authResult.userId,
          entries: {
            create: entries.map((e) => ({
              userId: e.userId,
              basePay: e.basePay,
              bonus: 0,
              deductions: 0,
              netPay: e.basePay,
              status: "PENDING",
            })),
          },
        },
      });

      return newRun;
    });

    await logAudit({
      action: "PAYROLL_RUN_CREATED",
      entityType: "PayrollRun",
      entityId: run.id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
    });

    revalidatePath("/dashboard/payroll");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: { id: run.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error creating payroll run:", error);
    return { success: false, error: "Failed to create payroll run" };
  }
}

/**
 * Update a payroll entry (only if run is DRAFT).
 */
export async function updatePayrollEntry(
  data: UpdatePayrollEntryInput
): Promise<ActionResult<void>> {
  const authResult = await checkAuth("payroll:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = updatePayrollEntrySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { id, basePay, bonus, deductions, deductionNotes, notes } = validation.data;

  try {
    await prisma.$transaction(async (tx) => {
      // Get entry with run info
      const entry = await tx.payrollEntry.findUnique({
        where: { id },
        include: {
          payrollRun: { select: { id: true, status: true, salonId: true } },
        },
      });

      if (!entry) {
        throw new Error("Payroll entry not found");
      }

      // Verify access
      const salonIds =
        authResult.role === "OWNER" || authResult.isSuperAdmin
          ? await getOrganizationSalonIds(authResult.salonId)
          : [authResult.salonId];

      if (!salonIds.includes(entry.payrollRun.salonId)) {
        throw new Error("Payroll entry not found");
      }

      if (entry.payrollRun.status !== "DRAFT") {
        throw new Error("Can only edit entries in DRAFT payroll runs");
      }

      const netPay = basePay + bonus - deductions;

      // Update entry
      await tx.payrollEntry.update({
        where: { id },
        data: {
          basePay,
          bonus,
          deductions,
          deductionNotes: deductionNotes || null,
          notes: notes || null,
          netPay,
        },
      });

      // Recalculate run totals (findMany returns updated values within the transaction)
      const allEntries = await tx.payrollEntry.findMany({
        where: { payrollRunId: entry.payrollRunId },
        select: { basePay: true, bonus: true, deductions: true, netPay: true },
      });

      await tx.payrollRun.update({
        where: { id: entry.payrollRunId },
        data: {
          totalBasePay: allEntries.reduce((sum, e) => sum + Number(e.basePay), 0),
          totalBonus: allEntries.reduce((sum, e) => sum + Number(e.bonus), 0),
          totalDeductions: allEntries.reduce((sum, e) => sum + Number(e.deductions), 0),
          totalNetPay: allEntries.reduce((sum, e) => sum + Number(e.netPay), 0),
        },
      });
    });

    await logAudit({
      action: "PAYROLL_ENTRY_UPDATED",
      entityType: "PayrollEntry",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { basePay, bonus, deductions },
    });

    revalidatePath("/dashboard/payroll");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error updating payroll entry:", error);
    return { success: false, error: "Failed to update payroll entry" };
  }
}

/**
 * Finalize a payroll run (DRAFT → FINALIZED). Locks entries.
 */
export async function finalizePayrollRun(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("payroll:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const run = await prisma.$transaction(async (tx) => {
      // Step 1: Find by ID only to determine the specific error
      const found = await tx.payrollRun.findUnique({ where: { id } });

      if (!found) {
        throw new Error("Payroll run not found");
      }

      if (!salonIds.includes(found.salonId)) {
        throw new Error("Branch no longer accessible");
      }

      if (found.status !== "DRAFT") {
        if (found.status === "FINALIZED") throw new Error("This payroll run has already been finalized");
        if (found.status === "PAID") throw new Error("This payroll run has already been paid");
        if (found.status === "CANCELLED") throw new Error("This payroll run has been cancelled");
      }

      // Step 2: Perform the update
      await tx.payrollRun.update({
        where: { id },
        data: { status: "FINALIZED" },
      });

      return found;
    });

    await logAudit({
      action: "PAYROLL_RUN_FINALIZED",
      entityType: "PayrollRun",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { totalNetPay: run.totalNetPay.toString() },
    });

    revalidatePath("/dashboard/payroll");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error finalizing payroll run:", error);
    return { success: false, error: "Failed to finalize payroll run" };
  }
}

/**
 * Mark a payroll run as PAID (FINALIZED → PAID). Owner only.
 * Optionally creates expense records under "Salaries" category.
 */
export async function markPayrollRunPaid(
  id: string,
  createExpenses: boolean
): Promise<ActionResult<void>> {
  const authResult = await checkAuth("payroll:pay");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const salonIds =
        authResult.role === "OWNER" || authResult.isSuperAdmin
          ? await getOrganizationSalonIds(authResult.salonId)
          : [authResult.salonId];

      // Step 1: Find by ID only to determine the specific error
      const run = await tx.payrollRun.findUnique({
        where: { id },
        include: {
          entries: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      });

      if (!run) {
        throw new Error("Payroll run not found");
      }

      if (!salonIds.includes(run.salonId)) {
        throw new Error("Branch no longer accessible");
      }

      if (run.status !== "FINALIZED") {
        if (run.status === "DRAFT") throw new Error("This payroll run is still a draft — finalize it first before marking as paid");
        if (run.status === "PAID") throw new Error("This payroll run has already been paid");
        if (run.status === "CANCELLED") throw new Error("This payroll run has been cancelled");
      }

      const now = new Date();

      // Update all PENDING entries to PAID
      await tx.payrollEntry.updateMany({
        where: { payrollRunId: id, status: "PENDING" },
        data: { status: "PAID", paidAt: now },
      });

      // Update run to PAID
      await tx.payrollRun.update({
        where: { id },
        data: { status: "PAID", paidAt: now },
      });

      // Optionally create expense records
      if (createExpenses) {
        const orgRootId = await getOrgRootSalonId(run.salonId);

        // Find "Salaries" expense category
        const salariesCategory = await tx.expenseCategory.findFirst({
          where: {
            salonId: orgRootId,
            name: "Salaries",
            isActive: true,
          },
        });

        if (salariesCategory) {
          const expenseDate = run.periodEnd;
          const periodLabel = `${run.periodStart.toISOString().slice(0, 10)} to ${run.periodEnd.toISOString().slice(0, 10)}`;

          const expenseData = run.entries
            .filter((entry) => Number(entry.netPay) > 0)
            .map((entry) => ({
              salonId: run.salonId,
              categoryId: salariesCategory.id,
              amount: entry.netPay,
              description: `Salary: ${entry.user.firstName} ${entry.user.lastName} (${periodLabel})`,
              date: expenseDate,
              createdById: authResult.userId,
            }));

          if (expenseData.length > 0) {
            await tx.expense.createMany({ data: expenseData });
          }
        }
      }
    });

    await logAudit({
      action: "PAYROLL_RUN_PAID",
      entityType: "PayrollRun",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { createExpenses },
    });

    revalidatePath("/dashboard/payroll");
    revalidatePath("/dashboard/expenses");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error marking payroll run paid:", error);
    return { success: false, error: "Failed to mark payroll run as paid" };
  }
}

/**
 * Cancel a payroll run (DRAFT/FINALIZED → CANCELLED).
 */
export async function cancelPayrollRun(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("payroll:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    await prisma.$transaction(async (tx) => {
      // Step 1: Find by ID only to determine the specific error
      const run = await tx.payrollRun.findUnique({ where: { id } });

      if (!run) {
        throw new Error("Payroll run not found");
      }

      if (!salonIds.includes(run.salonId)) {
        throw new Error("Branch no longer accessible");
      }

      if (run.status !== "DRAFT" && run.status !== "FINALIZED") {
        if (run.status === "PAID") throw new Error("This payroll run has already been paid and cannot be cancelled");
        if (run.status === "CANCELLED") throw new Error("This payroll run has already been cancelled");
      }

      // Step 2: Perform the updates
      await tx.payrollEntry.updateMany({
        where: { payrollRunId: id },
        data: { status: "CANCELLED" },
      });

      await tx.payrollRun.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    await logAudit({
      action: "PAYROLL_RUN_CANCELLED",
      entityType: "PayrollRun",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
    });

    revalidatePath("/dashboard/payroll");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error cancelling payroll run:", error);
    return { success: false, error: "Failed to cancel payroll run" };
  }
}

/**
 * Delete a payroll run (only DRAFT/CANCELLED). Owner only.
 */
export async function deletePayrollRun(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("payroll:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    await prisma.$transaction(async (tx) => {
      // Step 1: Find by ID only to determine the specific error
      const run = await tx.payrollRun.findUnique({ where: { id } });

      if (!run) {
        throw new Error("Payroll run not found");
      }

      if (!orgSalonIds.includes(run.salonId)) {
        throw new Error("Branch no longer accessible");
      }

      if (run.status !== "DRAFT" && run.status !== "CANCELLED") {
        if (run.status === "FINALIZED") throw new Error("This payroll run has been finalized — cancel it first before deleting");
        if (run.status === "PAID") throw new Error("This payroll run has already been paid and cannot be deleted");
      }

      // Step 2: Perform the delete
      await tx.payrollRun.delete({ where: { id } });
    });

    await logAudit({
      action: "PAYROLL_RUN_DELETED",
      entityType: "PayrollRun",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
    });

    revalidatePath("/dashboard/payroll");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    console.error("Error deleting payroll run:", error);
    return { success: false, error: "Failed to delete payroll run" };
  }
}

/**
 * Get payroll summary stats for the main payroll page.
 */
export async function getPayrollSummary(
  branchFilter: "current" | "all" = "current"
): Promise<ActionResult<PayrollSummary>> {
  const authResult = await checkAuth("payroll:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const isOwnerOrSuperAdmin = authResult.role === "OWNER" || authResult.isSuperAdmin;

    let salonIds: string[];
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      salonIds = await getOrganizationSalonIds(authResult.salonId);
    } else {
      salonIds = [authResult.salonId];
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [monthRuns, staffCount, pendingRuns] = await Promise.all([
      // This month's paid/finalized runs
      prisma.payrollRun.findMany({
        where: {
          salonId: { in: salonIds },
          status: { in: ["PAID", "FINALIZED"] },
          periodStart: { gte: monthStart, lte: monthEnd },
        },
        select: { totalNetPay: true },
      }),
      // Active staff count
      prisma.userSalon.count({
        where: { salonId: { in: salonIds }, isActive: true },
      }),
      // Pending (draft + finalized) runs
      prisma.payrollRun.count({
        where: {
          salonId: { in: salonIds },
          status: { in: ["DRAFT", "FINALIZED"] },
        },
      }),
    ]);

    const totalPayrollThisMonth = monthRuns.reduce(
      (sum, r) => sum + Number(r.totalNetPay),
      0
    );

    return {
      success: true,
      data: {
        totalPayrollThisMonth,
        totalStaff: staffCount,
        pendingRuns,
        avgSalary: staffCount > 0 ? Math.round(totalPayrollThisMonth / staffCount) : 0,
      },
    };
  } catch (error) {
    console.error("Error fetching payroll summary:", error);
    return { success: false, error: "Failed to fetch payroll summary" };
  }
}

/**
 * Get payroll history for a specific staff member (or the current user's own history).
 * Staff can view their own payroll entries without special permission.
 * Admins/Owners can view any staff member's history with payroll:view.
 */
export async function getStaffPayrollHistory(
  userId?: string
): Promise<
  ActionResult<{
    entries: (PayrollEntryItem & {
      payrollRun: {
        periodStart: Date;
        periodEnd: Date;
        status: PayrollRunStatus;
      };
    })[];
  }>
> {
  const { checkAuthBasic } = await import("@/lib/auth-helpers");
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // If viewing someone else's history, require payroll:view permission
  const targetUserId = userId || authResult.userId;
  if (targetUserId !== authResult.userId) {
    const { hasPermission } = await import("@/lib/permissions");
    if (!hasPermission(authResult.role, "payroll:view", authResult.isSuperAdmin)) {
      return { success: false, error: "Unauthorized" };
    }
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const entries = await prisma.payrollEntry.findMany({
      where: {
        userId: targetUserId,
        payrollRun: {
          salonId: { in: salonIds },
          status: { in: ["PAID", "FINALIZED"] },
        },
      },
      select: {
        id: true,
        basePay: true,
        bonus: true,
        deductions: true,
        deductionNotes: true,
        netPay: true,
        status: true,
        notes: true,
        paidAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        payrollRun: {
          select: { periodStart: true, periodEnd: true, status: true },
        },
      },
      orderBy: { payrollRun: { periodStart: "desc" } },
    });

    return {
      success: true,
      data: { entries: entries as (PayrollEntryItem & { payrollRun: { periodStart: Date; periodEnd: Date; status: PayrollRunStatus } })[] },
    };
  } catch (error) {
    console.error("Error fetching staff payroll history:", error);
    return { success: false, error: "Failed to fetch payroll history" };
  }
}
