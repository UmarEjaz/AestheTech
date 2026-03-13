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
import { logAudit } from "./audit";

async function checkAuth(permission: string): Promise<{ userId: string; role: Role; salonId: string } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const salonId = session.user.salonId;
  if (!salonId) return null;

  const role = session.user.salonRole as Role;
  if (!hasPermission(role, permission as "services:view" | "services:manage")) {
    return null;
  }

  return { userId: session.user.id, role, salonId };
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
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 12;
  const skip = (safePage - 1) * safeLimit;

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
        take: safeLimit,
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
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
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
      salonId: authResult.salonId,
      description: description || null,
      category: category || null,
    },
  });

  await logAudit({
    action: "SERVICE_CREATED",
    entityType: "Service",
    entityId: service.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { name: rest.name, price: rest.price, duration: rest.duration },
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

  const changes: Record<string, { from: string | number | null; to: string | number | null }> = {};
  if (rest.name !== undefined && rest.name !== existingService.name) changes.name = { from: existingService.name, to: rest.name };
  if (rest.price !== undefined && Number(rest.price) !== Number(existingService.price)) changes.price = { from: Number(existingService.price), to: Number(rest.price) };
  if (rest.duration !== undefined && rest.duration !== existingService.duration) changes.duration = { from: existingService.duration, to: rest.duration };
  if (category !== undefined && (category || null) !== existingService.category) changes.category = { from: existingService.category, to: category || null };

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
