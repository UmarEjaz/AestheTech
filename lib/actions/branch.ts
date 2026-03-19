"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { branchSchema, BranchFormData } from "@/lib/validations/branch";
import { Role } from "@prisma/client";
import { logAudit } from "./audit";

export type BranchListItem = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { users: number };
};

export type BranchDetail = BranchListItem & {
  staff: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
    isActive: boolean;
  }[];
};

/**
 * Get all branches in the same organization as the current salon.
 */
export async function getBranches(): Promise<ActionResult<BranchListItem[]>> {
  const authResult = await checkAuth("branches:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Find the current salon to determine the organization root
    const currentSalon = await prisma.salon.findUnique({
      where: { id: authResult.salonId },
      select: { id: true, parentSalonId: true },
    });

    if (!currentSalon) {
      return { success: false, error: "Salon not found" };
    }

    // The organization root is the parent salon, or the current salon if it has no parent
    const rootSalonId = currentSalon.parentSalonId || currentSalon.id;

    // Get all salons in this organization (root + branches)
    const branches = await prisma.salon.findMany({
      where: {
        OR: [
          { id: rootSalonId },
          { parentSalonId: rootSalonId },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { users: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return { success: true, data: branches as BranchListItem[] };
  } catch (error) {
    console.error("Error fetching branches:", error);
    return { success: false, error: "Failed to fetch branches" };
  }
}

/**
 * Create a new branch under the current salon's organization.
 */
export async function createBranch(
  data: BranchFormData
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("branches:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = branchSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { name, slug, address, phone, email } = validationResult.data;

  try {
    // Check slug uniqueness
    const existingSlug = await prisma.salon.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      return { success: false, error: "A salon with this slug already exists" };
    }

    // Determine the parent salon ID
    const currentSalon = await prisma.salon.findUnique({
      where: { id: authResult.salonId },
      select: { id: true, parentSalonId: true, subscriptionStatus: true, subscriptionPlan: true },
    });

    if (!currentSalon) {
      return { success: false, error: "Current salon not found" };
    }

    const parentId = currentSalon.parentSalonId || currentSalon.id;

    // Create branch salon with settings in a transaction
    const branch = await prisma.$transaction(async (tx) => {
      const newBranch = await tx.salon.create({
        data: {
          name,
          slug,
          address: address || null,
          phone: phone || null,
          email: email || null,
          parentSalonId: parentId,
          subscriptionStatus: currentSalon.subscriptionStatus,
          subscriptionPlan: currentSalon.subscriptionPlan,
        },
      });

      // Create default settings for the branch
      await tx.settings.create({
        data: {
          salonId: newBranch.id,
          salonName: name,
          salonAddress: address || null,
          salonPhone: phone || null,
          salonEmail: email || null,
        },
      });

      // Give the current user (Owner) access to the new branch
      await tx.userSalon.create({
        data: {
          userId: authResult.userId,
          salonId: newBranch.id,
          role: Role.OWNER,
        },
      });

      return newBranch;
    });

    await logAudit({
      action: "BRANCH_CREATED",
      entityType: "Salon",
      entityId: branch.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name, slug, parentSalonId: parentId },
    });

    revalidatePath("/dashboard/branches");

    return { success: true, data: { id: branch.id } };
  } catch (error) {
    console.error("Error creating branch:", error);
    return { success: false, error: "Failed to create branch" };
  }
}

/**
 * Get branch detail including staff list.
 */
export async function getBranchDetail(
  branchSalonId: string
): Promise<ActionResult<BranchDetail>> {
  const authResult = await checkAuth("branches:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify the branch belongs to the same organization
    const currentSalon = await prisma.salon.findUnique({
      where: { id: authResult.salonId },
      select: { id: true, parentSalonId: true },
    });

    if (!currentSalon) {
      return { success: false, error: "Salon not found" };
    }

    const rootSalonId = currentSalon.parentSalonId || currentSalon.id;

    const branch = await prisma.salon.findUnique({
      where: { id: branchSalonId },
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
        parentSalonId: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });

    if (!branch) {
      return { success: false, error: "Branch not found" };
    }

    // Verify same organization
    const branchRoot = branch.parentSalonId || branch.id;
    if (branchRoot !== rootSalonId && branch.id !== rootSalonId) {
      return { success: false, error: "Branch does not belong to your organization" };
    }

    // Get staff assigned to this branch via UserSalon
    const userSalons = await prisma.userSalon.findMany({
      where: {
        salonId: branchSalonId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
      },
      orderBy: { user: { firstName: "asc" } },
    });

    const staff = userSalons.map((us) => ({
      id: us.user.id,
      firstName: us.user.firstName,
      lastName: us.user.lastName,
      email: us.user.email,
      role: us.role,
      isActive: us.user.isActive,
    }));

    const result: BranchDetail = {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      isActive: branch.isActive,
      createdAt: branch.createdAt,
      _count: branch._count,
      staff,
    };

    return { success: true, data: result };
  } catch (error) {
    console.error("Error fetching branch detail:", error);
    return { success: false, error: "Failed to fetch branch details" };
  }
}
