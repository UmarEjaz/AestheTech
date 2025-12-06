"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { clientSchema, clientUpdateSchema, ClientFormData, ClientSearchParams } from "@/lib/validations/client";
import { Role, Prisma } from "@prisma/client";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function checkAuth(permission: string): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission as "clients:view" | "clients:create" | "clients:update" | "clients:delete")) {
    return null;
  }

  return { userId: session.user.id, role };
}

const clientListInclude = Prisma.validator<Prisma.ClientInclude>()({
  loyaltyPoints: true,
  _count: {
    select: {
      appointments: true,
      sales: true,
    },
  },
});

export type ClientListItem = Prisma.ClientGetPayload<{
  include: typeof clientListInclude;
}>;

export async function getClients(params: ClientSearchParams = {}): Promise<ActionResult<{
  clients: ClientListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, tags, isActive = true, page = 1, limit = 10 } = params;
  const skip = (page - 1) * limit;

  const where = {
    isActive,
    ...(query && {
      OR: [
        { firstName: { contains: query, mode: "insensitive" as const } },
        { lastName: { contains: query, mode: "insensitive" as const } },
        { email: { contains: query, mode: "insensitive" as const } },
        { phone: { contains: query } },
      ],
    }),
    ...(tags && tags.length > 0 && {
      tags: { hasSome: tags },
    }),
  };

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: clientListInclude,
    }),
    prisma.client.count({ where }),
  ]);

  return {
    success: true,
    data: {
      clients,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  };
}

const clientInclude = Prisma.validator<Prisma.ClientInclude>()({
  loyaltyPoints: true,
  appointments: {
    orderBy: { startTime: "desc" },
    take: 10,
    include: {
      service: true,
      staff: {
        select: { firstName: true, lastName: true },
      },
    },
  },
  sales: {
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      items: {
        include: {
          service: true,
        },
      },
    },
  },
});

export type ClientWithRelations = Prisma.ClientGetPayload<{
  include: typeof clientInclude;
}>;

export async function getClient(id: string): Promise<ActionResult<ClientWithRelations | null>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const client = await prisma.client.findUnique({
    where: { id },
    include: clientInclude,
  });

  if (!client) {
    return { success: false, error: "Client not found" };
  }

  return { success: true, data: client };
}

export async function createClient(data: ClientFormData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("clients:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = clientSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { birthday, email, ...rest } = validationResult.data;

  // Check for duplicate phone number
  const existingClient = await prisma.client.findUnique({
    where: { phone: rest.phone },
  });

  if (existingClient) {
    return { success: false, error: "A client with this phone number already exists" };
  }

  const client = await prisma.client.create({
    data: {
      ...rest,
      email: email || null,
      birthday: birthday ? new Date(birthday) : null,
      loyaltyPoints: {
        create: {
          balance: 0,
          tier: "SILVER",
        },
      },
    },
  });

  revalidatePath("/dashboard/clients");
  return { success: true, data: { id: client.id } };
}

export async function updateClient(data: { id: string } & Partial<ClientFormData>): Promise<ActionResult> {
  const authResult = await checkAuth("clients:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = clientUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, birthday, email, ...rest } = validationResult.data;

  // Check if client exists
  const existingClient = await prisma.client.findUnique({
    where: { id },
  });

  if (!existingClient) {
    return { success: false, error: "Client not found" };
  }

  // Check for duplicate phone number if phone is being updated
  if (rest.phone && rest.phone !== existingClient.phone) {
    const duplicatePhone = await prisma.client.findUnique({
      where: { phone: rest.phone },
    });

    if (duplicatePhone) {
      return { success: false, error: "A client with this phone number already exists" };
    }
  }

  await prisma.client.update({
    where: { id },
    data: {
      ...rest,
      ...(email !== undefined && { email: email || null }),
      ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
    },
  });

  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${id}`);
  return { success: true, data: undefined };
}

export async function deleteClient(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("clients:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          appointments: true,
          sales: true,
        },
      },
    },
  });

  if (!client) {
    return { success: false, error: "Client not found" };
  }

  // Soft delete - mark as inactive instead of hard delete
  await prisma.client.update({
    where: { id },
    data: { isActive: false },
  });

  revalidatePath("/dashboard/clients");
  return { success: true, data: undefined };
}

export async function restoreClient(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("clients:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const client = await prisma.client.findUnique({
    where: { id },
  });

  if (!client) {
    return { success: false, error: "Client not found" };
  }

  await prisma.client.update({
    where: { id },
    data: { isActive: true },
  });

  revalidatePath("/dashboard/clients");
  return { success: true, data: undefined };
}

export async function getAllTags(): Promise<ActionResult<string[]>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const clients = await prisma.client.findMany({
    select: { tags: true },
    where: { isActive: true },
  });

  const allTags = new Set<string>();
  clients.forEach((client) => {
    client.tags.forEach((tag) => allTags.add(tag));
  });

  return { success: true, data: Array.from(allTags).sort() };
}
