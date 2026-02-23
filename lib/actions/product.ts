"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  productSchema,
  productUpdateSchema,
  ProductFormData,
  ProductSearchParams,
} from "@/lib/validations/product";
import { Role, Prisma } from "@prisma/client";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function checkAuth(permission: string): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission as "products:view" | "products:manage")) {
    return null;
  }

  return { userId: session.user.id, role };
}

const productListInclude = Prisma.validator<Prisma.ProductInclude>()({
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
  categories: string[];
}>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, category, isActive = true, lowStock, page = 1, limit = 12 } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.ProductWhereInput = {
    isActive,
    ...(query && {
      OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        { description: { contains: query, mode: "insensitive" as const } },
        { sku: { contains: query, mode: "insensitive" as const } },
      ],
    }),
    ...(category && { category }),
  };

  const [allProducts, total, allCategoryProducts] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: productListInclude,
    }),
    prisma.product.count({ where }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ["category"],
    }),
  ]);

  // Apply low stock filter in-memory (comparing two columns)
  let filteredProducts = allProducts;
  if (lowStock) {
    filteredProducts = allProducts.filter((p) => p.stock <= p.lowStockThreshold);
  }

  const filteredTotal = lowStock ? filteredProducts.length : total;
  const paginatedProducts = filteredProducts.slice(skip, skip + limit);

  const categories = allCategoryProducts
    .map((p) => p.category)
    .filter((c): c is string => c !== null)
    .sort();

  return {
    success: true,
    data: {
      products: paginatedProducts,
      total: filteredTotal,
      page,
      totalPages: Math.ceil(filteredTotal / limit),
      categories,
    },
  };
}

export async function getProduct(id: string): Promise<ActionResult<ProductListItem | null>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const product = await prisma.product.findUnique({
    where: { id },
    include: productListInclude,
  });

  if (!product) {
    return { success: false, error: "Product not found" };
  }

  return { success: true, data: product };
}

export async function createProduct(data: ProductFormData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("products:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = productSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { description, category, sku, cost, ...rest } = validationResult.data;

  // Check SKU uniqueness if provided
  if (sku) {
    const existing = await prisma.product.findUnique({ where: { sku } });
    if (existing) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
  }

  const product = await prisma.product.create({
    data: {
      ...rest,
      description: description || null,
      category: category || null,
      sku: sku || null,
      cost: cost ?? null,
    },
  });

  revalidatePath("/dashboard/products");
  return { success: true, data: { id: product.id } };
}

export async function updateProduct(
  data: { id: string } & Partial<ProductFormData>
): Promise<ActionResult> {
  const authResult = await checkAuth("products:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = productUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, description, category, sku, cost, ...rest } = validationResult.data;

  const existingProduct = await prisma.product.findUnique({
    where: { id },
  });

  if (!existingProduct) {
    return { success: false, error: "Product not found" };
  }

  // Check SKU uniqueness if changed
  if (sku !== undefined && sku && sku !== existingProduct.sku) {
    const skuExists = await prisma.product.findUnique({ where: { sku } });
    if (skuExists) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
  }

  await prisma.product.update({
    where: { id },
    data: {
      ...rest,
      ...(description !== undefined && { description: description || null }),
      ...(category !== undefined && { category: category || null }),
      ...(sku !== undefined && { sku: sku || null }),
      ...(cost !== undefined && { cost: cost ?? null }),
    },
  });

  revalidatePath("/dashboard/products");
  return { success: true, data: undefined };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("products:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          saleItems: true,
        },
      },
    },
  });

  if (!product) {
    return { success: false, error: "Product not found" };
  }

  // Soft delete - mark as inactive
  await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });

  revalidatePath("/dashboard/products");
  return { success: true, data: undefined };
}

export async function restoreProduct(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("products:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    return { success: false, error: "Product not found" };
  }

  await prisma.product.update({
    where: { id },
    data: { isActive: true },
  });

  revalidatePath("/dashboard/products");
  return { success: true, data: undefined };
}

export async function getAllProductCategories(): Promise<ActionResult<string[]>> {
  const authResult = await checkAuth("products:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { category: true },
    distinct: ["category"],
  });

  const categories = products
    .map((p) => p.category)
    .filter((c): c is string => c !== null)
    .sort();

  return { success: true, data: categories };
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

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      category: true,
      points: true,
      sku: true,
      lowStockThreshold: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return {
    success: true,
    data: products.map((p) => ({
      ...p,
      price: Number(p.price),
    })),
  };
}
