"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  serviceSchema,
  serviceUpdateSchema,
  ServiceFormData,
  ServiceSearchParams,
} from "@/lib/validations/service";
import { Role, Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";

async function checkAuth(permission: string): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission as "services:view" | "services:manage")) {
    return null;
  }

  return { userId: session.user.id, role };
}

const serviceListInclude = Prisma.validator<Prisma.ServiceInclude>()({
  _count: {
    select: {
      appointments: true,
      saleItems: true,
    },
  },
});

export type ServiceListItem = Prisma.ServiceGetPayload<{
  include: typeof serviceListInclude;
}>;

export async function getServices(params: ServiceSearchParams = {}): Promise<ActionResult<{
  services: ServiceListItem[];
  total: number;
  page: number;
  totalPages: number;
  categories: string[];
}>> {
  const authResult = await checkAuth("services:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, category, isActive = true, page = 1, limit = 12 } = params;
  const skip = (page - 1) * limit;

  try {
    const where = {
      isActive,
      ...(query && {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { description: { contains: query, mode: "insensitive" as const } },
        ],
      }),
      ...(category && { category }),
    };

    const [services, total, allServices] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy: [{ category: "asc" }, { name: "asc" }],
        skip,
        take: limit,
        include: serviceListInclude,
      }),
      prisma.service.count({ where }),
      prisma.service.findMany({
        where: { isActive: true },
        select: { category: true },
        distinct: ["category"],
      }),
    ]);

    const categories = allServices
      .map((s) => s.category)
      .filter((c): c is string => c !== null)
      .sort();

    return {
      success: true,
      data: {
        services,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        categories,
      },
    };
  } catch (error) {
    console.error("Error fetching services:", error);
    return { success: false, error: "Failed to fetch services" };
  }
}

export async function getService(id: string): Promise<ActionResult<ServiceListItem | null>> {
  const authResult = await checkAuth("services:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const service = await prisma.service.findUnique({
      where: { id },
      include: serviceListInclude,
    });

    if (!service) {
      return { success: false, error: "Service not found" };
    }

    return { success: true, data: service };
  } catch (error) {
    console.error("Error fetching service:", error);
    return { success: false, error: "Failed to fetch service" };
  }
}

export async function createService(data: ServiceFormData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("services:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = serviceSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { description, category, ...rest } = validationResult.data;

  const service = await prisma.service.create({
    data: {
      ...rest,
      description: description || null,
      category: category || null,
    },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: { id: service.id } };
}

export async function updateService(
  data: { id: string } & Partial<ServiceFormData>
): Promise<ActionResult> {
  const authResult = await checkAuth("services:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = serviceUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, description, category, ...rest } = validationResult.data;

  const existingService = await prisma.service.findUnique({
    where: { id },
  });

  if (!existingService) {
    return { success: false, error: "Service not found" };
  }

  await prisma.service.update({
    where: { id },
    data: {
      ...rest,
      ...(description !== undefined && { description: description || null }),
      ...(category !== undefined && { category: category || null }),
    },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function deleteService(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("services:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          appointments: true,
          saleItems: true,
        },
      },
    },
  });

  if (!service) {
    return { success: false, error: "Service not found" };
  }

  // Soft delete - mark as inactive
  await prisma.service.update({
    where: { id },
    data: { isActive: false },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function restoreService(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("services:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const service = await prisma.service.findUnique({
    where: { id },
  });

  if (!service) {
    return { success: false, error: "Service not found" };
  }

  await prisma.service.update({
    where: { id },
    data: { isActive: true },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function getAllCategories(): Promise<ActionResult<string[]>> {
  const authResult = await checkAuth("services:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ["category"],
    });

    const categories = services
      .map((s) => s.category)
      .filter((c): c is string => c !== null)
      .sort();

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching service categories:", error);
    return { success: false, error: "Failed to fetch categories" };
  }
}
