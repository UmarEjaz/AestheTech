"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { salaryConfigSchema, SalaryConfigInput } from "@/lib/validations/payroll";
import { getOrganizationSalonIds } from "./branch";
import { logAudit } from "./audit";

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
 * Get salary configs. Owners see all branches when branchFilter is "all".
 */
export async function getSalaryConfigs(
  branchFilter: "current" | "all" = "current"
): Promise<ActionResult<SalaryConfigListItem[]>> {
  const authResult = await checkAuth("salary-config:view");
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

    const configs = await prisma.salaryConfig.findMany({
      where: { salonId: { in: salonIds } },
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
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const config = await prisma.salaryConfig.findFirst({
      where: { id, salonId: { in: salonIds } },
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
    // Verify the caller has access to this salon
    const authorizedSalonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    if (!authorizedSalonIds.includes(salonId)) {
      return { success: false, error: "Unauthorized access to this branch" };
    }

    const config = await prisma.salaryConfig.findFirst({
      where: {
        userId,
        salonId,
        isActive: true,
        effectiveDate: { lte: new Date() },
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
  const authResult = await checkAuth("salary-config:manage");
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
  const authResult = await checkAuth("salary-config:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = salaryConfigSchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { userId, payType, baseRate, effectiveDate, notes } = validation.data;

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const existing = await prisma.salaryConfig.findFirst({
      where: { id, salonId: { in: salonIds } },
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

    const config = await prisma.salaryConfig.update({
      where: { id },
      data: {
        userId,
        payType,
        baseRate,
        effectiveDate,
        notes: notes || null,
      },
    });

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
 * Soft-delete a salary config (set isActive=false).
 */
export async function deleteSalaryConfig(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("salary-config:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salonIds =
      authResult.role === "OWNER" || authResult.isSuperAdmin
        ? await getOrganizationSalonIds(authResult.salonId)
        : [authResult.salonId];

    const existing = await prisma.salaryConfig.findFirst({
      where: { id, salonId: { in: salonIds } },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    if (!existing) {
      return { success: false, error: "Salary configuration not found" };
    }

    await prisma.salaryConfig.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

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
 * Get staff members at the current branch (for dropdowns).
 */
export async function getBranchStaff(): Promise<
  ActionResult<{ id: string; firstName: string; lastName: string; email: string; role: string }[]>
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
      },
    });

    const staff = userSalons.map((us) => ({
      id: us.user.id,
      firstName: us.user.firstName,
      lastName: us.user.lastName,
      email: us.user.email,
      role: us.role,
    }));

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching branch staff:", error);
    return { success: false, error: "Failed to fetch staff members" };
  }
}
