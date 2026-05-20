"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

/**
 * Assign a staff member to a branch.
 * Both salons must be in the same organization.
 */
export async function assignStaffToBranch(
  userId: string,
  targetSalonId: string,
  roleDefinitionId: string
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("staff:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Validate role exists (system or salon-scoped)
    const roleDef = await prisma.roleDefinition.findFirst({
      where: {
        id: roleDefinitionId,
        OR: [{ isSystem: true }, { salonId: targetSalonId }],
      },
      select: { id: true, name: true },
    });
    if (!roleDef) {
      return { success: false, error: "Invalid role" };
    }

    // Enforce hierarchy — caller must outrank the role being assigned
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.roleId, roleDefinitionId, authResult.isSuperAdmin, targetSalonId))) {
      return { success: false, error: "Cannot assign a role above your level" };
    }

    // Verify same organization
    const [currentSalon, targetSalon] = await Promise.all([
      prisma.salon.findUnique({
        where: { id: authResult.salonId },
        select: { id: true, parentSalonId: true },
      }),
      prisma.salon.findUnique({
        where: { id: targetSalonId },
        select: { id: true, parentSalonId: true, name: true },
      }),
    ]);

    if (!currentSalon || !targetSalon) {
      return { success: false, error: "Salon not found" };
    }

    const currentRoot = currentSalon.parentSalonId || currentSalon.id;
    const targetRoot = targetSalon.parentSalonId || targetSalon.id;

    if (currentRoot !== targetRoot) {
      return { success: false, error: "Target branch is not in your organization" };
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Verify user belongs to the same organization
    const orgSalons = await prisma.salon.findMany({
      where: { OR: [{ id: currentRoot }, { parentSalonId: currentRoot }] },
      select: { id: true },
    });
    const orgSalonIds = orgSalons.map((s) => s.id);

    const userInOrg = await prisma.userSalon.findFirst({
      where: { userId, salonId: { in: orgSalonIds }, isActive: true },
    });

    if (!userInOrg) {
      return { success: false, error: "User is not a member of your organization" };
    }

    // Check if already assigned
    const existing = await prisma.userSalon.findUnique({
      where: { userId_salonId: { userId, salonId: targetSalonId } },
    });

    if (existing) {
      if (existing.isActive) {
        return { success: false, error: "User is already assigned to this branch" };
      }
      // Reactivate
      await prisma.userSalon.update({
        where: { id: existing.id },
        data: { isActive: true, roleDefinitionId },
      });

      await logAudit({
        action: "STAFF_ASSIGNED_TO_BRANCH",
        entityType: "UserSalon",
        entityId: existing.id,
        userId: authResult.userId,
        userRole: authResult.role,
        details: {
          staffEmail: user.email,
          staffName: `${user.firstName} ${user.lastName}`,
          targetBranch: targetSalon.name,
          roleDefinitionId,
        },
      });

      revalidatePath("/dashboard/branches");
      return { success: true, data: { id: existing.id } };
    }

    // Create new assignment
    const userSalon = await prisma.userSalon.create({
      data: { userId, salonId: targetSalonId, roleDefinitionId },
    });

    await logAudit({
      action: "STAFF_ASSIGNED_TO_BRANCH",
      entityType: "UserSalon",
      entityId: userSalon.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: {
        staffEmail: user.email,
        staffName: `${user.firstName} ${user.lastName}`,
        targetBranch: targetSalon.name,
        roleDefinitionId,
      },
    });

    revalidatePath("/dashboard/branches");
    return { success: true, data: { id: userSalon.id } };
  } catch (error) {
    console.error("Error assigning staff to branch:", error);
    return { success: false, error: "Failed to assign staff to branch" };
  }
}

/**
 * Remove a staff member from a branch.
 * Ensures user has at least one other salon. If removing from their current salon, switches them.
 */
export async function removeStaffFromBranch(
  userId: string,
  salonId: string
): Promise<ActionResult> {
  const authResult = await checkAuth("staff:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify same organization
    const [currentSalon, targetSalon] = await Promise.all([
      prisma.salon.findUnique({
        where: { id: authResult.salonId },
        select: { id: true, parentSalonId: true },
      }),
      prisma.salon.findUnique({
        where: { id: salonId },
        select: { id: true, parentSalonId: true, name: true },
      }),
    ]);

    if (!currentSalon || !targetSalon) {
      return { success: false, error: "Salon not found" };
    }

    const currentRoot = currentSalon.parentSalonId || currentSalon.id;
    const targetRoot = targetSalon.parentSalonId || targetSalon.id;

    if (currentRoot !== targetRoot) {
      return { success: false, error: "Target branch is not in your organization" };
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, salonId: true, firstName: true, lastName: true, email: true },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Find the UserSalon record
    const userSalon = await prisma.userSalon.findUnique({
      where: { userId_salonId: { userId, salonId } },
    });

    if (!userSalon || !userSalon.isActive) {
      return { success: false, error: "User is not assigned to this branch" };
    }

    // Enforce hierarchy — caller must outrank the user's role at the target branch
    const { canManageRole } = await import("@/lib/permissions");
    if (!(await canManageRole(authResult.roleId, userSalon.roleDefinitionId, authResult.isSuperAdmin, salonId))) {
      return { success: false, error: "Cannot remove a user with a role above your level" };
    }

    // Ensure user has at least one other active salon
    const otherSalons = await prisma.userSalon.findMany({
      where: {
        userId,
        isActive: true,
        salonId: { not: salonId },
        salon: { isActive: true },
      },
      include: { salon: { select: { id: true } } },
      take: 1,
    });

    if (otherSalons.length === 0) {
      return {
        success: false,
        error: "Cannot remove user from their only salon. They must belong to at least one salon.",
      };
    }

    await prisma.$transaction(async (tx) => {
      // Deactivate the UserSalon record
      await tx.userSalon.update({
        where: { id: userSalon.id },
        data: { isActive: false },
      });

      // If user's current salon is the one being removed, switch them
      if (user.salonId === salonId) {
        const fallback = otherSalons[0];
        await tx.user.update({
          where: { id: userId },
          data: {
            salonId: fallback.salon.id,
            roleDefinitionId: fallback.roleDefinitionId,
          },
        });
      }
    });

    await logAudit({
      action: "STAFF_REMOVED_FROM_BRANCH",
      entityType: "UserSalon",
      entityId: userSalon.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: {
        staffEmail: user.email,
        staffName: `${user.firstName} ${user.lastName}`,
        removedFromBranch: targetSalon.name,
      },
    });

    revalidatePath("/dashboard/branches");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error removing staff from branch:", error);
    return { success: false, error: "Failed to remove staff from branch" };
  }
}

/**
 * Get staff from the organization who are NOT yet assigned to a specific branch.
 * Used in the "Add Staff" dialog.
 */
export async function getAvailableStaffForBranch(
  targetSalonId: string
): Promise<ActionResult<{ id: string; firstName: string; lastName: string; email: string; role: string; roleName: string }[]>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Determine organization root
    const currentSalon = await prisma.salon.findUnique({
      where: { id: authResult.salonId },
      select: { id: true, parentSalonId: true },
    });

    if (!currentSalon) {
      return { success: false, error: "Salon not found" };
    }

    const rootSalonId = currentSalon.parentSalonId || currentSalon.id;

    // Get all salons in the org
    const orgSalons = await prisma.salon.findMany({
      where: {
        OR: [{ id: rootSalonId }, { parentSalonId: rootSalonId }],
      },
      select: { id: true },
    });

    const orgSalonIds = orgSalons.map((s) => s.id);

    // Verify target branch belongs to this organization
    if (!orgSalonIds.includes(targetSalonId)) {
      return { success: false, error: "Target branch is not in your organization" };
    }

    // Get users already assigned to target branch
    const assignedUserIds = (
      await prisma.userSalon.findMany({
        where: { salonId: targetSalonId, isActive: true },
        select: { userId: true },
      })
    ).map((us) => us.userId);

    // Get org staff not assigned to target branch
    const availableStaff = await prisma.userSalon.findMany({
      where: {
        salonId: { in: orgSalonIds },
        isActive: true,
        userId: { notIn: assignedUserIds },
        user: { isActive: true },
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        roleDefinition: {
          select: { slug: true, name: true },
        },
      },
      distinct: ["userId"],
    });

    const result = availableStaff.map((us) => ({
      id: us.user.id,
      firstName: us.user.firstName,
      lastName: us.user.lastName,
      email: us.user.email,
      role: us.roleDefinition.slug,
      roleName: us.roleDefinition.name,
    }));

    return { success: true, data: result };
  } catch (error) {
    console.error("Error fetching available staff:", error);
    return { success: false, error: "Failed to fetch available staff" };
  }
}
