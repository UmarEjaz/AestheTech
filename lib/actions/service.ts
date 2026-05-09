"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import {
  serviceSchema,
  serviceUpdateSchema,
  ServiceFormData,
  ServiceSearchParams,
} from "@/lib/validations/service";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

const serviceListInclude = Prisma.validator<Prisma.ServiceInclude>()({
  category: {
    select: { id: true, name: true },
  },
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
  categories: { id: string; name: string }[];
}>> {
  const authResult = await checkAuth("services:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, category, isActive = true, page = 1, limit = 12 } = params;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 12;
  const skip = (safePage - 1) * safeLimit;

  try {
    const where: Prisma.ServiceWhereInput = {
      salonId: authResult.salonId,
      isActive,
      ...(query && {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { description: { contains: query, mode: "insensitive" as const } },
        ],
      }),
      ...(category && { categoryId: category }),
    };

    // Fetch categories from the ServiceCategory table via the org root
    const { getOrgRootSalonId } = await import("./branch");
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const [services, total, allCategories] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
        skip,
        take: safeLimit,
        include: serviceListInclude,
      }),
      prisma.service.count({ where }),
      prisma.serviceCategory.findMany({
        where: { salonId: orgRootId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      success: true,
      data: {
        services,
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
        categories: allCategories,
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
    const service = await prisma.service.findFirst({
      where: { id, salonId: authResult.salonId },
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
  const authResult = await checkAuth("services:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = serviceSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { description, categoryId, cost, ...rest } = validationResult.data;

  const service = await prisma.service.create({
    data: {
      ...rest,
      salonId: authResult.salonId,
      description: description || null,
      categoryId: categoryId || null,
      cost: cost ?? null,
    },
  });

  await logAudit({
    action: "SERVICE_CREATED",
    entityType: "Service",
    entityId: service.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { name: rest.name, price: rest.price, cost: cost ?? null, duration: rest.duration },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: { id: service.id } };
}

export async function updateService(
  data: { id: string } & Partial<ServiceFormData>
): Promise<ActionResult> {
  const authResult = await checkAuth("services:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = serviceUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, description, categoryId, cost, ...rest } = validationResult.data;

  const existingService = await prisma.service.findFirst({
    where: { id, salonId: authResult.salonId },
  });

  if (!existingService) {
    return { success: false, error: "Service not found" };
  }

  await prisma.service.update({
    where: { id },
    data: {
      ...rest,
      ...(description !== undefined && { description: description || null }),
      ...(categoryId !== undefined && { categoryId: categoryId || null }),
      ...(cost !== undefined && { cost: cost ?? null }),
    },
  });

  const changes: Record<string, { from: string | number | null; to: string | number | null }> = {};
  if (rest.name !== undefined && rest.name !== existingService.name) changes.name = { from: existingService.name, to: rest.name };
  if (rest.price !== undefined && Number(rest.price) !== Number(existingService.price)) changes.price = { from: Number(existingService.price), to: Number(rest.price) };
  if (cost !== undefined && Number(cost ?? 0) !== Number(existingService.cost ?? 0)) changes.cost = { from: Number(existingService.cost ?? 0), to: Number(cost ?? 0) };
  if (rest.duration !== undefined && rest.duration !== existingService.duration) changes.duration = { from: existingService.duration, to: rest.duration };
  if (categoryId !== undefined && (categoryId || null) !== existingService.categoryId) changes.categoryId = { from: existingService.categoryId, to: categoryId || null };

  await logAudit({
    action: "SERVICE_UPDATED",
    entityType: "Service",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: changes,
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function deleteService(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("services:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const service = await prisma.service.findFirst({
    where: { id, salonId: authResult.salonId },
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

  await logAudit({
    action: "SERVICE_DELETED",
    entityType: "Service",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { name: service.name },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function restoreService(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("services:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const service = await prisma.service.findFirst({
    where: { id, salonId: authResult.salonId },
  });

  if (!service) {
    return { success: false, error: "Service not found" };
  }

  await prisma.service.update({
    where: { id },
    data: { isActive: true },
  });

  await logAudit({
    action: "SERVICE_RESTORED",
    entityType: "Service",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { name: service.name },
  });

  revalidatePath("/dashboard/services");
  return { success: true, data: undefined };
}

export async function getAllCategories(): Promise<ActionResult<{ id: string; name: string }[]>> {
  const authResult = await checkAuth("service-categories:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const { getOrgRootSalonId } = await import("./branch");
    const orgRootId = await getOrgRootSalonId(authResult.salonId);

    const categories = await prisma.serviceCategory.findMany({
      where: { salonId: orgRootId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return { success: true, data: categories };
  } catch (error) {
    console.error("Error fetching service categories:", error);
    return { success: false, error: "Failed to fetch categories" };
  }
}
