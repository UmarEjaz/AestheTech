"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { serviceCategorySchema, ServiceCategoryInput } from "@/lib/validations/service-category";
import { getOrgRootSalonId } from "./branch";
import { logAudit } from "./audit";

export type ServiceCategoryItem = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count: { services: number };
};

const DEFAULT_CATEGORIES = [
  { name: "Hair", icon: "Scissors", color: "#9333EA" },
  { name: "Nails", icon: "Paintbrush", color: "#EC4899" },
  { name: "Skin", icon: "Sparkles", color: "#F59E0B" },
  { name: "Makeup", icon: "Palette", color: "#EF4444" },
  { name: "Massage", icon: "Hand", color: "#22C55E" },
  { name: "Waxing", icon: "Flame", color: "#F97316" },
  { name: "Other", icon: "MoreHorizontal", color: "#6B7280" },
];

/**
 * Lazy-seed default categories for an organization if none exist.
 */
async function ensureDefaultCategories(orgRootSalonId: string): Promise<void> {
  const count = await prisma.serviceCategory.count({
    where: { salonId: orgRootSalonId },
  });

  if (count > 0) return;

  await prisma.serviceCategory.createMany({
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
 * Get all service categories for the organization.
 */
export async function getServiceCategories(): Promise<ActionResult<ServiceCategoryItem[]>> {
  const authResult = await checkAuth("service-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.serviceCategory.findMany({
      where: { salonId: orgRootId },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        isDefault: true,
        isActive: true,
        _count: { select: { services: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching service categories:", error);
    return { success: false, error: "Failed to fetch service categories" };
  }
}

/**
 * Get only active service categories (for dropdowns).
 */
export async function getActiveServiceCategories(): Promise<
  ActionResult<{ id: string; name: string; icon: string | null; color: string | null }[]>
> {
  const authResult = await checkAuth("service-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.serviceCategory.findMany({
      where: { salonId: orgRootId, isActive: true },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { name: "asc" },
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching active service categories:", error);
    return { success: false, error: "Failed to fetch service categories" };
  }
}

/**
 * Create a new service category.
 */
export async function createServiceCategory(
  data: ServiceCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("service-categories:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = serviceCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const category = await prisma.serviceCategory.create({
      data: {
        salonId: orgRootId,
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    await logAudit({
      action: "SERVICE_CATEGORY_CREATED",
      entityType: "ServiceCategory",
      entityId: category.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name },
    });

    revalidatePath("/dashboard/services");
    return { success: true, data: { id: category.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error creating service category:", error);
    return { success: false, error: "Failed to create service category" };
  }
}

/**
 * Update a service category.
 */
export async function updateServiceCategory(
  id: string,
  data: ServiceCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("service-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = serviceCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    // Verify the category belongs to this org
    const existing = await prisma.serviceCategory.findFirst({
      where: { id, salonId: orgRootId },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const category = await prisma.serviceCategory.update({
      where: { id },
      data: {
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    await logAudit({
      action: "SERVICE_CATEGORY_UPDATED",
      entityType: "ServiceCategory",
      entityId: category.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name, previousName: existing.name },
    });

    revalidatePath("/dashboard/services");
    return { success: true, data: { id: category.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error updating service category:", error);
    return { success: false, error: "Failed to update service category" };
  }
}

/**
 * Toggle a service category's active status.
 */
export async function toggleServiceCategory(
  id: string
): Promise<ActionResult<{ isActive: boolean }>> {
  const authResult = await checkAuth("service-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const existing = await prisma.serviceCategory.findFirst({
      where: { id, salonId: orgRootId },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const updated = await prisma.serviceCategory.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await logAudit({
      action: updated.isActive ? "SERVICE_CATEGORY_RESTORED" : "SERVICE_CATEGORY_DEACTIVATED",
      entityType: "ServiceCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: existing.name },
    });

    revalidatePath("/dashboard/services");
    return { success: true, data: { isActive: updated.isActive } };
  } catch (error) {
    console.error("Error toggling service category:", error);
    return { success: false, error: "Failed to update service category" };
  }
}
