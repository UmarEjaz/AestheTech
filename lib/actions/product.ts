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
import { ActionResult } from "@/lib/types";

type ProductPermission = "products:view" | "products:manage";

async function checkAuth(permission: ProductPermission): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission)) {
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

  try {
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

    // When lowStock filter is active, we must fetch all and filter in-memory
    // (Prisma can't compare two columns). Otherwise, use DB-level pagination.
    const [fetchedProducts, total, allCategoryProducts] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: productListInclude,
        ...(lowStock ? {} : { skip, take: limit }),
      }),
      lowStock ? Promise.resolve(0) : prisma.product.count({ where }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { category: true },
        distinct: ["category"],
      }),
    ]);

    let paginatedProducts: ProductListItem[];
    let filteredTotal: number;

    if (lowStock) {
      const filteredProducts = fetchedProducts.filter((p) => p.stock <= p.lowStockThreshold);
      filteredTotal = filteredProducts.length;
      paginatedProducts = filteredProducts.slice(skip, skip + limit);
    } else {
      filteredTotal = total;
      paginatedProducts = fetchedProducts;
    }

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
    const product = await prisma.product.findUnique({
      where: { id },
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
  const authResult = await checkAuth("products:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = productSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { description, category, sku, cost, ...rest } = validationResult.data;

  try {
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
    throw error;
  }
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

  try {
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: `A product with SKU "${sku}" already exists` };
    }
    throw error;
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
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

  try {
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
  } catch (error) {
    console.error("Error fetching active products:", error);
    return { success: false, error: "Failed to fetch products" };
  }
}
