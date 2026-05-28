"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth, checkAuthBasic } from "@/lib/auth-helpers";
import { hasAnyPermission } from "@/lib/permissions";
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
export async function getAllProductCategories(): Promise<ActionResult<ProductCategoryItem[]>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }
  // Shopify-style implicit bundling: any role authorised to manage products (create or
  // update) implicitly gets read access to the category catalog needed to fill the form.
  // The category-management page still requires the explicit `product-categories:view`.
  const canRead = await hasAnyPermission(
    authResult.roleId || null,
    ["product-categories:view", "products:create", "products:update"],
    authResult.isSuperAdmin,
    authResult.salonId,
    authResult.userId
  );
  if (!canRead) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.productCategory.findMany({
      where: { salonId: orgRootId, deletedAt: null },
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
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }
  // Shopify-style implicit bundling: any role authorised to manage products (create or
  // update) implicitly gets read access to the category catalog needed to fill the form.
  const canRead = await hasAnyPermission(
    authResult.roleId || null,
    ["product-categories:view", "products:create", "products:update"],
    authResult.isSuperAdmin,
    authResult.salonId,
    authResult.userId
  );
  if (!canRead) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);
    await ensureDefaultCategories(orgRootId);

    const categories = await prisma.productCategory.findMany({
      where: { salonId: orgRootId, isActive: true, deletedAt: null },
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
    revalidatePath("/dashboard/products/categories");
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

    // Fetch existing for audit-log purposes only (we need the previous name)
    const existing = await prisma.productCategory.findFirst({
      where: { id, salonId: orgRootId, deletedAt: null },
      select: { name: true },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    // Atomic update: verification filters are part of the update itself,
    // so a race between the find above and the write here can't silently
    // change a category that no longer belongs to this org or got soft-deleted.
    const result = await prisma.productCategory.updateMany({
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
      action: "PRODUCT_CATEGORY_UPDATED",
      entityType: "ProductCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name, previousName: existing.name },
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/products/categories");
    return { success: true, data: { id } };
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
      where: { id, salonId: orgRootId, deletedAt: null },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    // Race-safe write: filter the update with the same predicate as the existence check
    // so a concurrent soft-delete or org reassignment between the check and the update
    // fails closed (count === 0) instead of flipping a stale row.
    const result = await prisma.productCategory.updateMany({
      where: { id, salonId: orgRootId, deletedAt: null },
      data: { isActive: !existing.isActive },
    });

    if (result.count === 0) {
      return { success: false, error: "Category not found" };
    }

    await logAudit({
      action: !existing.isActive ? "PRODUCT_CATEGORY_RESTORED" : "PRODUCT_CATEGORY_DEACTIVATED",
      entityType: "ProductCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: existing.name },
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/products/categories");
    return { success: true, data: { isActive: !existing.isActive } };
  } catch (error) {
    console.error("Error toggling product category:", error);
    return { success: false, error: "Failed to update product category" };
  }
}

/**
 * Delete a product category.
 * - Hard-deletes when no references exist anywhere (excluding audit logs).
 * - Soft-deletes (sets deletedAt) when only "other" references exist beyond Products.
 * - Blocks with an error if any Product still references it (defense-in-depth — UI also disables).
 */
export async function deleteProductCategory(
  id: string
): Promise<ActionResult<{ hardDeleted: boolean }>> {
  const authResult = await checkAuth("product-categories:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const existing = await prisma.productCategory.findFirst({
      where: { id, salonId: orgRootId, deletedAt: null },
    });

    if (!existing) {
      return { success: false, error: "Category not found" };
    }

    const productsCount = await prisma.product.count({
      where: { categoryId: id },
    });
    if (productsCount > 0) {
      return {
        success: false,
        error: `Cannot delete: ${productsCount} product(s) use this category. Deactivate it instead.`,
      };
    }

    // "Other references" check — defensive future-proofing.
    // No other tables currently reference ProductCategory.
    const otherReferencesCount = 0;

    const snapshot = {
      name: existing.name,
      icon: existing.icon,
      color: existing.color,
      isDefault: existing.isDefault,
      isActive: existing.isActive,
      createdAt: existing.createdAt,
    };

    // Race-safe write: filter the mutation with the same predicate as the existence
    // check so a concurrent change between the check and the write fails closed.
    let hardDeleted: boolean;
    if (otherReferencesCount > 0) {
      const result = await prisma.productCategory.updateMany({
        where: { id, salonId: orgRootId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        return { success: false, error: "Category not found" };
      }
      hardDeleted = false;
    } else {
      const result = await prisma.productCategory.deleteMany({
        where: { id, salonId: orgRootId, deletedAt: null },
      });
      if (result.count === 0) {
        return { success: false, error: "Category not found" };
      }
      hardDeleted = true;
    }

    await logAudit({
      action: "PRODUCT_CATEGORY_DELETED",
      entityType: "ProductCategory",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { hardDeleted, snapshot },
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/products/categories");
    return { success: true, data: { hardDeleted } };
  } catch (error) {
    console.error("Error deleting product category:", error);
    return { success: false, error: "Failed to delete product category" };
  }
}
