"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import {
  productSchema,
  productUpdateSchema,
  ProductFormData,
  ProductSearchParams,
} from "@/lib/validations/product";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { getOrganizationSalonIds } from "./branch";

const productListInclude = Prisma.validator<Prisma.ProductInclude>()({
  category: {
    select: { id: true, name: true },
  },
  _count: {
    select: {
      saleItems: true,
    },
  },
});

export type ProductListItem = Prisma.ProductGetPayload<{
  include: typeof productListInclude;
}>;

export async function getProducts(params: ProductSearchParams = {}): Promise<ActionResult<{
  products: ProductListItem[];
  total: number;
  page: number;
  totalPages: number;
  categories: { id: string; name: string }[];
}>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, category, isActive = true, lowStock, page = 1, limit = 12 } = params;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 12;
  const skip = (safePage - 1) * safeLimit;

  try {
    // Get all salon IDs in the organization for cross-branch product visibility
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    const where: Prisma.ProductWhereInput = {
      salonId: { in: orgSalonIds },
      isActive,
      ...(query && {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { description: { contains: query, mode: "insensitive" as const } },
          { sku: { contains: query, mode: "insensitive" as const } },
        ],
      }),
      ...(category && { categoryId: category }),
    };

    // Fetch categories from the ProductCategory table via the org root
    const { getOrgRootSalonId } = await import("./branch");
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    // When lowStock filter is active, we must fetch all and filter in-memory
    // (Prisma can't compare two columns). Otherwise, use DB-level pagination.
    const [fetchedProducts, total, allCategories] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
        include: productListInclude,
        ...(lowStock ? {} : { skip, take: safeLimit }),
      }),
      lowStock ? Promise.resolve(0) : prisma.product.count({ where }),
      prisma.productCategory.findMany({
        where: { salonId: orgRootId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    let paginatedProducts: ProductListItem[];
    let filteredTotal: number;

    if (lowStock) {
      const filteredProducts = fetchedProducts.filter((p) => p.stock <= p.lowStockThreshold);
      filteredTotal = filteredProducts.length;
      paginatedProducts = filteredProducts.slice(skip, skip + safeLimit);
    } else {
      filteredTotal = total;
      paginatedProducts = fetchedProducts;
    }

    return {
      success: true,
      data: {
        products: paginatedProducts,
        total: filteredTotal,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(filteredTotal / safeLimit)),
        categories: allCategories,
      },
    };
  } catch (error) {
    console.error("Error fetching products:", error);
    return { success: false, error: "Failed to fetch products" };
  }
}

export async function getProduct(id: string): Promise<ActionResult<ProductListItem | null>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    const product = await prisma.product.findFirst({
      where: { id, salonId: { in: orgSalonIds } },
      include: productListInclude,
    });

    if (!product) {
      return { success: false, error: "Product not found" };
    }

    return { success: true, data: product };
  } catch (error) {
    console.error("Error fetching product:", error);
    return { success: false, error: "Failed to fetch product" };
  }
}

export async function createProduct(data: ProductFormData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("products:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = productSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { description, categoryId, sku, cost, ...rest } = validationResult.data;

  try {
    const product = await prisma.product.create({
      data: {
        ...rest,
        salonId: authResult.salonId,
        description: description || null,
        categoryId: categoryId || null,
        sku: sku || null,
        cost: cost ?? null,
      },
    });

    await logAudit({
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: product.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: rest.name, price: rest.price, stock: rest.stock, sku },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: { id: product.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
    console.error("Error creating product:", error);
    return { success: false, error: "Failed to create product" };
  }
}

export async function updateProduct(
  data: { id: string } & Partial<ProductFormData>
): Promise<ActionResult> {
  const authResult = await checkAuth("products:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = productUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, description, categoryId, sku, cost, ...rest } = validationResult.data;

  try {
    const existingProduct = await prisma.product.findFirst({
      where: { id, salonId: authResult.salonId },
    });

    if (!existingProduct) {
      return { success: false, error: "Product not found" };
    }

    await prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(description !== undefined && { description: description || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
        ...(sku !== undefined && { sku: sku || null }),
        ...(cost !== undefined && { cost: cost ?? null }),
      },
    });

    const changes: Record<string, { from: string | number | null; to: string | number | null }> = {};
    if (rest.name !== undefined && rest.name !== existingProduct.name) changes.name = { from: existingProduct.name, to: rest.name };
    if (rest.price !== undefined && Number(rest.price) !== Number(existingProduct.price)) changes.price = { from: Number(existingProduct.price), to: Number(rest.price) };
    if (rest.stock !== undefined && rest.stock !== existingProduct.stock) changes.stock = { from: existingProduct.stock, to: rest.stock };
    if (sku !== undefined && (sku || null) !== existingProduct.sku) changes.sku = { from: existingProduct.sku, to: sku || null };
    if (categoryId !== undefined && (categoryId || null) !== existingProduct.categoryId) changes.categoryId = { from: existingProduct.categoryId, to: categoryId || null };

    await logAudit({
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: changes,
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: undefined };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
    console.error("Error updating product:", error);
    return { success: false, error: "Failed to update product" };
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("products:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const product = await prisma.product.findFirst({
      where: { id, salonId: authResult.salonId },
    });

    if (!product) {
      return { success: false, error: "Product not found" };
    }

    // Soft delete - mark as inactive
    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    await logAudit({
      action: "PRODUCT_DELETED",
      entityType: "Product",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: product.name, sku: product.sku },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting product:", error);
    return { success: false, error: "Failed to delete product" };
  }
}

export async function restoreProduct(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("products:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const product = await prisma.product.findFirst({
      where: { id, salonId: authResult.salonId },
    });

    if (!product) {
      return { success: false, error: "Product not found" };
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: true },
    });

    await logAudit({
      action: "PRODUCT_RESTORED",
      entityType: "Product",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { name: product.name, sku: product.sku },
    });

    revalidatePath("/dashboard/products");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error restoring product:", error);
    return { success: false, error: "Failed to restore product" };
  }
}

export async function getAllProductCategories(): Promise<ActionResult<{ id: string; name: string }[]>> {
  const authResult = await checkAuth("product-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const { getOrgRootSalonId } = await import("./branch");
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const categories = await prisma.productCategory.findMany({
      where: { salonId: orgRootId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching product categories:", error);
    return { success: false, error: "Failed to fetch categories" };
  }
}

export async function getActiveProducts(): Promise<ActionResult<{
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string | null;
  points: number;
  sku: string | null;
  lowStockThreshold: number;
}[]>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Use current branch only — inventory/stock is branch-specific
    const products = await prisma.product.findMany({
      where: { salonId: authResult.salonId, isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        stock: true,
        category: { select: { name: true } },
        points: true,
        sku: true,
        lowStockThreshold: true,
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });

    return {
      success: true,
      data: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        stock: p.stock,
        category: p.category?.name ?? null,
        points: p.points,
        sku: p.sku,
        lowStockThreshold: p.lowStockThreshold,
      })),
    };
  } catch (error) {
    console.error("Error fetching active products:", error);
    return { success: false, error: "Failed to fetch products" };
  }
}
