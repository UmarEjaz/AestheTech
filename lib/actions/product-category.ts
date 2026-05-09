"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
import { productCategorySchema, ProductCategoryInput } from "@/lib/validations/product-category";
import { getOrgRootSalonId } from "./branch";
import { logAudit } from "./audit";

export type ProductCategoryItem = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count: { products: number };
};

const DEFAULT_CATEGORIES = [
  { name: "Hair Care", icon: "Sparkles", color: "#9333EA" },
  { name: "Skin Care", icon: "Droplet", color: "#3B82F6" },
  { name: "Nail Care", icon: "Paintbrush", color: "#EC4899" },
  { name: "Styling Tools", icon: "Wrench", color: "#F59E0B" },
  { name: "Accessories", icon: "Gem", color: "#8B5CF6" },
  { name: "Other", icon: "MoreHorizontal", color: "#6B7280" },
];

/**
 * Lazy-seed default categories for an organization if none exist.
 */
async function ensureDefaultCategories(orgRootSalonId: string): Promise<void> {
  const count = await prisma.productCategory.count({
    where: { salonId: orgRootSalonId },
  });

  if (count > 0) return;

  await prisma.productCategory.createMany({
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
 * Get all product categories for the organization.
 */
export async function getProductCategories(): Promise<ActionResult<ProductCategoryItem[]>> {
  const authResult = await checkAuth("product-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.productCategory.findMany({
      where: { salonId: orgRootId },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        isDefault: true,
        isActive: true,
        _count: { select: { products: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching product categories:", error);
    return { success: false, error: "Failed to fetch product categories" };
  }
}

/**
 * Get only active product categories (for dropdowns).
 */
export async function getActiveProductCategories(): Promise<
  ActionResult<{ id: string; name: string; icon: string | null; color: string | null }[]>
> {
  const authResult = await checkAuth("product-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.productCategory.findMany({
      where: { salonId: orgRootId, isActive: true },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { name: "asc" },
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching active product categories:", error);
    return { success: false, error: "Failed to fetch product categories" };
  }
}

/**
 * Create a new product category.
 */
export async function createProductCategory(
  data: ProductCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("product-categories:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = productCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const category = await prisma.productCategory.create({
      data: {
        salonId: orgRootId,
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    await logAudit({
      action: "PRODUCT_CATEGORY_CREATED",
      entityType: "ProductCategory",
      entityId: category.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: { id: category.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error creating product category:", error);
    return { success: false, error: "Failed to create product category" };
  }
}

/**
 * Update a product category.
 */
export async function updateProductCategory(
  id: string,
  data: ProductCategoryInput
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("product-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validation = productCategorySchema.safeParse(data);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, icon, color } = validation.data;

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    // Verify the category belongs to this org
    const existing = await prisma.productCategory.findFirst({
      where: { id, salonId: orgRootId },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const category = await prisma.productCategory.update({
      where: { id },
      data: {
        name,
        icon: icon || null,
        color: color || null,
      },
    });

    await logAudit({
      action: "PRODUCT_CATEGORY_UPDATED",
      entityType: "ProductCategory",
      entityId: category.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name, previousName: existing.name },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: { id: category.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "A category with this name already exists" };
    }
    console.error("Error updating product category:", error);
    return { success: false, error: "Failed to update product category" };
  }
}

/**
 * Toggle a product category's active status.
 */
export async function toggleProductCategory(
  id: string
): Promise<ActionResult<{ isActive: boolean }>> {
  const authResult = await checkAuth("product-categories:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const existing = await prisma.productCategory.findFirst({
      where: { id, salonId: orgRootId },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await logAudit({
      action: updated.isActive ? "PRODUCT_CATEGORY_RESTORED" : "PRODUCT_CATEGORY_DEACTIVATED",
      entityType: "ProductCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: existing.name },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: { isActive: updated.isActive } };
  } catch (error) {
    console.error("Error toggling product category:", error);
    return { success: false, error: "Failed to update product category" };
  }
}
