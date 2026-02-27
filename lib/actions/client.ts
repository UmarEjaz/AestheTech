"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { clientSchema, clientUpdateSchema, walkInClientSchema, ClientFormData, ClientSearchParams, WalkInClientData } from "@/lib/validations/client";
import { Role, Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";

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

  const { query, tags, isActive = true, isWalkIn, page = 1, limit = 10 } = params;
  const skip = (page - 1) * limit;

  try {
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
      ...(isWalkIn !== undefined && {
        isWalkIn,
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
  } catch (error) {
    console.error("Error fetching clients:", error);
    return { success: false, error: "Failed to fetch clients" };
  }
}

// Function to get client include with fresh date filter (avoids stale date issue)
function getClientInclude() {
  return {
    loyaltyPoints: true,
    appointments: {
      orderBy: { startTime: "desc" as const },
      take: 10,
      include: {
        service: true,
        staff: {
          select: { firstName: true, lastName: true },
        },
      },
    },
    sales: {
      orderBy: { createdAt: "desc" as const },
      take: 10,
      include: {
        items: {
          include: {
            service: true,
            product: true,
          },
        },
      },
    },
    loyaltyTransactions: {
      orderBy: { createdAt: "desc" as const },
      take: 50,
    },
    recurringSeries: {
      orderBy: { createdAt: "desc" as const },
      include: {
        service: {
          select: { name: true, duration: true },
        },
        staff: {
          select: { firstName: true, lastName: true },
        },
        client: {
          select: { firstName: true, lastName: true },
        },
        exceptions: {
          select: { id: true, date: true, reason: true },
          orderBy: { date: "asc" as const },
        },
        appointments: {
          where: {
            startTime: { gte: new Date() }, // Evaluated fresh on each call
            status: { notIn: ["CANCELLED", "NO_SHOW"] as const },
          },
          orderBy: { startTime: "asc" as const },
          select: {
            id: true,
            startTime: true,
            status: true,
          },
        },
      },
    },
  } satisfies Prisma.ClientInclude;
}

export type ClientWithRelations = Prisma.ClientGetPayload<{
  include: ReturnType<typeof getClientInclude>;
}>;

export async function getClient(id: string): Promise<ActionResult<ClientWithRelations | null>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const client = await prisma.client.findUnique({
      where: { id },
      include: getClientInclude(),
    });

    if (!client) {
      return { success: false, error: "Client not found" };
    }

    return { success: true, data: client };
  } catch (error) {
    console.error("Error fetching client:", error);
    return { success: false, error: "Failed to fetch client" };
  }
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

// Create a walk-in client with minimal information
export async function createWalkInClient(data: WalkInClientData): Promise<ActionResult<{ id: string; firstName: string }>> {
  const authResult = await checkAuth("clients:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = walkInClientSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { firstName, phone } = validationResult.data;
  const normalizedPhone = phone && phone.trim() !== "" ? phone : null;

  // Check for duplicate phone number if phone is provided
  if (normalizedPhone) {
    const existingClient = await prisma.client.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existingClient) {
      // Return existing client instead of creating duplicate
      return {
        success: true,
        data: { id: existingClient.id, firstName: existingClient.firstName }
      };
    }
  }

  const client = await prisma.client.create({
    data: {
      firstName,
      lastName: null,
      phone: normalizedPhone,
      isWalkIn: true,
      loyaltyPoints: {
        create: {
          balance: 0,
          tier: "SILVER",
        },
      },
    },
  });

  revalidatePath("/dashboard/clients");
  return { success: true, data: { id: client.id, firstName: client.firstName } };
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

  try {
    const clients = await prisma.client.findMany({
      select: { tags: true },
      where: { isActive: true },
    });

    const allTags = new Set<string>();
    clients.forEach((client) => {
      client.tags.forEach((tag) => allTags.add(tag));
    });

    return { success: true, data: Array.from(allTags).sort() };
  } catch (error) {
    console.error("Error fetching tags:", error);
    return { success: false, error: "Failed to fetch tags" };
  }
}
