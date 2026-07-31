"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { salaryConfigSchema, SalaryConfigInput } from "@/lib/validations/payroll";
import { logAudit } from "./audit";
import { getTimezone } from "./settings";
import { formatInTz } from "@/lib/utils/timezone";

export type SalaryConfigListItem = {
  id: string;
  payType: string;
  baseRate: Prisma.Decimal;
  effectiveDate: Date;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  salon: {
    id: string;
    name: string;
  };
};

const salaryConfigSelect = {
  id: true,
  payType: true,
  baseRate: true,
  effectiveDate: true,
  notes: true,
  isActive: true,
  createdAt: true,
  user: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  salon: {
    select: { id: true, name: true },
  },
} satisfies Prisma.SalaryConfigSelect;

/**
 * Get salary configs for the caller's current branch. Operational lists are always
 * branch-scoped; cross-branch visibility lives in reports/dashboards/audit only.
 */
export async function getSalaryConfigs(): Promise<ActionResult<SalaryConfigListItem[]>> {
  const authResult = await checkAuth("salary-config:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const configs = await prisma.salaryConfig.findMany({
      where: { salonId: authResult.salonId },
      select: salaryConfigSelect,
      orderBy: [{ isActive: "desc" }, { effectiveDate: "desc" }],
    });

    return { success: true, data: configs as SalaryConfigListItem[] };
  } catch (error) {
    console.error("Error fetching salary configs:", error);
    return { success: false, error: "Failed to fetch salary configurations" };
  }
}

/**
 * Get a single salary config by ID.
 */
export async function getSalaryConfig(id: string): Promise<ActionResult<SalaryConfigListItem>> {
  const authResult = await checkAuth("salary-config:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const config = await prisma.salaryConfig.findFirst({
      where: { id, salonId: authResult.salonId },
      select: salaryConfigSelect,
    });

    if (!config) {
      return { success: false, error: "Salary configuration not found" };
    }

    return { success: true, data: config as SalaryConfigListItem };
  } catch (error) {
    console.error("Error fetching salary config:", error);
    return { success: false, error: "Failed to fetch salary configuration" };
  }
}

/**
 * Get the current effective salary config for a staff member.
 */
export async function getStaffCurrentConfig(
  userId: string,
  salonId: string
): Promise<ActionResult<SalaryConfigListItem | null>> {
  const authResult = await checkAuth("salary-config:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Operational reads are branch-scoped: callers must be on the same branch as the
    // requested salonId. To view a staff member's config at another branch, switch first.
    if (salonId !== authResult.salonId) {
      return { success: false, error: "Unauthorized access to this branch" };
    }

    // "Effective as of today" in the salon timezone. effectiveDate is a date-only field stored
    // at UTC midnight, so compare against the salon's current calendar date as a UTC-midnight
    // instant — an absolute tz boundary would spill into the next UTC day and select a config
    // that only becomes effective tomorrow.
    const tz = await getTimezone();
    const localToday = new Date(`${formatInTz(new Date(), "yyyy-MM-dd", tz)}T00:00:00Z`);
    const config = await prisma.salaryConfig.findFirst({
      where: {
        userId,
        salonId,
        isActive: true,
        effectiveDate: { lte: localToday },
      },
      select: salaryConfigSelect,
      orderBy: { effectiveDate: "desc" },
    });

    return { success: true, data: config as SalaryConfigListItem | null };
  } catch (error) {
    console.error("Error fetching staff config:", error);
    return { success: false, error: "Failed to fetch staff salary configuration" };
  }
}

/**
 * Create a new salary config.
 */
export async function createSalaryConfig(
  data: SalaryConfigInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("salary-config:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = salaryConfigSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { userId, payType, baseRate, effectiveDate, notes } = validation.data;

  try {
    // Verify staff belongs to branch via UserSalon
    const userSalon = await prisma.userSalon.findFirst({
      where: { userId, salonId: authResult.salonId, isActive: true },
    });

    if (!userSalon) {
      return { success: false, error: "Staff member not found at this branch" };
    }

    const config = await prisma.salaryConfig.create({
      data: {
        salonId: authResult.salonId,
        userId,
        payType,
        baseRate,
        effectiveDate,
        notes: notes || null,
      },
    });

    await logAudit({
      action: "SALARY_CONFIG_CREATED",
      entityType: "SalaryConfig",
      entityId: config.id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { staffUserId: userId, payType, baseRate, effectiveDate: effectiveDate.toISOString() },
    });

    revalidatePath("/dashboard/payroll/salary-config");
    return { success: true, data: { id: config.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A salary config already exists for this staff member on this effective date" };
    }
    console.error("Error creating salary config:", error);
    return { success: false, error: "Failed to create salary configuration" };
  }
}

/**
 * Update an existing salary config.
 */
export async function updateSalaryConfig(
  id: string,
  data: SalaryConfigInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("salary-config:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = salaryConfigSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { userId, payType, baseRate, effectiveDate, notes } = validation.data;

  try {
    // Mutations are always scoped to the caller's current branch. `data:all-branches`
    // is a VIEW permission and must not widen update authority.
    const existing = await prisma.salaryConfig.findFirst({
      where: { id, salonId: authResult.salonId },
    });

    if (!existing) {
      return { success: false, error: "Salary configuration not found" };
    }

    // If userId changed, verify the new staff member belongs to this branch
    if (userId !== existing.userId) {
      const userSalon = await prisma.userSalon.findFirst({
        where: { userId, salonId: existing.salonId, isActive: true },
      });

      if (!userSalon) {
        return { success: false, error: "Staff member not found at this branch" };
      }
    }

    // Atomic write: keep the branch predicate in the WHERE so a concurrent salonId
    // change between the preflight and the write can't slip through.
    const updateResult = await prisma.salaryConfig.updateMany({
      where: { id, salonId: authResult.salonId },
      data: {
        userId,
        payType,
        baseRate,
        effectiveDate,
        notes: notes || null,
      },
    });
    if (updateResult.count === 0) {
      return { success: false, error: "Salary configuration not found" };
    }
    const config = { id };

    await logAudit({
      action: "SALARY_CONFIG_UPDATED",
      entityType: "SalaryConfig",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: {
        previousBaseRate: existing.baseRate.toString(),
        newBaseRate: baseRate.toString(),
        payType,
      },
    });

    revalidatePath("/dashboard/payroll/salary-config");
    return { success: true, data: { id: config.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A salary config already exists for this staff member on this effective date" };
    }
    console.error("Error updating salary config:", error);
    return { success: false, error: "Failed to update salary configuration" };
  }
}

/**
 * Toggle a salary config's active status. Flips isActive (true ↔ false).
 * Gated on `salary-config:update` because flipping isActive is an update, not a delete.
 */
export async function toggleSalaryConfigActive(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("salary-config:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Mutations are always scoped to the caller's current branch.
    const existing = await prisma.salaryConfig.findFirst({
      where: { id, salonId: authResult.salonId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    if (!existing) {
      return { success: false, error: "Salary configuration not found" };
    }

    // Atomic write: keep the branch predicate in the WHERE.
    const toggleResult = await prisma.salaryConfig.updateMany({
      where: { id, salonId: authResult.salonId },
      data: { isActive: !existing.isActive },
    });
    if (toggleResult.count === 0) {
      return { success: false, error: "Salary configuration not found" };
    }

    await logAudit({
      action: existing.isActive ? "SALARY_CONFIG_DEACTIVATED" : "SALARY_CONFIG_RESTORED",
      entityType: "SalaryConfig",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: {
        staffName: `${existing.user.firstName} ${existing.user.lastName}`,
        baseRate: existing.baseRate.toString(),
      },
    });

    revalidatePath("/dashboard/payroll/salary-config");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error toggling salary config:", error);
    return { success: false, error: "Failed to update salary configuration" };
  }
}

/**
 * Hard delete a salary config. Any PayrollEntry rows referencing this config will have
 * their `salaryConfigId` set to null by the DB (the FK uses `onDelete: SetNull`), so
 * historical payroll amounts (`basePay`) remain intact — only the audit link is lost.
 */
export async function deleteSalaryConfig(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("salary-config:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Mutations are always scoped to the caller's current branch.
    const existing = await prisma.salaryConfig.findFirst({
      where: { id, salonId: authResult.salonId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    if (!existing) {
      return { success: false, error: "Salary configuration not found" };
    }

    // Atomic delete: keep the branch predicate in the WHERE.
    const deleteResult = await prisma.salaryConfig.deleteMany({
      where: { id, salonId: authResult.salonId },
    });
    if (deleteResult.count === 0) {
      return { success: false, error: "Salary configuration not found" };
    }

    await logAudit({
      action: "SALARY_CONFIG_DELETED",
      entityType: "SalaryConfig",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: {
        staffName: `${existing.user.firstName} ${existing.user.lastName}`,
        baseRate: existing.baseRate.toString(),
        payType: existing.payType,
      },
    });

    revalidatePath("/dashboard/payroll/salary-config");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting salary config:", error);
    return { success: false, error: "Failed to delete salary configuration" };
  }
}

/**
 * Get staff members at the current branch (for dropdowns).
 */
export async function getBranchStaff(): Promise<
  ActionResult<{ id: string; firstName: string; lastName: string; email: string; role: string; roleName: string }[]>
> {
  const authResult = await checkAuth("salary-config:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const userSalons = await prisma.userSalon.findMany({
      where: { salonId: authResult.salonId, isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        roleDefinition: { select: { slug: true, name: true } },
      },
    });

    const staff = userSalons.map((us) => ({
      id: us.user.id,
      firstName: us.user.firstName,
      lastName: us.user.lastName,
      email: us.user.email,
      role: us.roleDefinition.slug,
      roleName: us.roleDefinition.name,
    }));

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching branch staff:", error);
    return { success: false, error: "Failed to fetch staff members" };
  }
}
