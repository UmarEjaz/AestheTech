"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { clientSchema, clientUpdateSchema, walkInClientSchema, bookingClientSchema, ClientFormData, ClientSearchParams, WalkInClientData, BookingClientData } from "@/lib/validations/client";
import { Prisma, LoyaltyTier, AppointmentStatus } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { invalidateDashboardCache } from "@/lib/redis";
import { getOrganizationSalonIds } from "./branch";
import { isModuleEnabled } from "./modules";

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
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;
  const skip = (safePage - 1) * safeLimit;

  try {
    // Get all salon IDs in the organization for cross-branch client visibility
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    const where = {
      salonId: { in: orgSalonIds },
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
        take: safeLimit,
        include: clientListInclude,
      }),
      prisma.client.count({ where }),
    ]);

    return {
      success: true,
      data: {
        clients,
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
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
    // "Total visits" = completed appointments only (not scheduled/cancelled/no-show).
    _count: {
      select: {
        appointments: { where: { status: "COMPLETED" as const } },
      },
    },
    appointments: {
      orderBy: { startTime: "desc" as const },
      take: 10,
      include: {
        services: {
          orderBy: { order: "asc" as const },
          select: { service: { select: { name: true } } },
        },
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

// Sum of deposits/prepayments taken against this client's appointments that haven't yet
// been applied at checkout (invoiceId null) — i.e. money held but not yet earned.
export async function getClientHeldDeposits(clientId: string): Promise<number> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) return 0;

  const result = await prisma.payment.aggregate({
    where: {
      invoiceId: null,
      appointment: { clientId, salonId: authResult.salonId },
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

export async function getClient(id: string): Promise<ActionResult<ClientWithRelations | null>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Allow viewing clients from any branch in the organization
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    const client = await prisma.client.findFirst({
      where: { id, salonId: { in: orgSalonIds } },
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

  const { birthday, email, photoUrl, ...rest } = validationResult.data;

  const { salonId } = authResult;

  // Check for duplicate phone number
  if (rest.phone) {
    const existingClient = await prisma.client.findUnique({
      where: { salonId_phone: { salonId, phone: rest.phone } },
    });

    if (existingClient) {
      return { success: false, error: "A client with this phone number already exists" };
    }
  }

  const client = await prisma.client.create({
    data: {
      ...rest,
      salonId,
      email: email || null,
      photoUrl: photoUrl || null,
      birthday: birthday ? new Date(birthday) : null,
      loyaltyPoints: {
        create: {
          salonId,
          balance: 0,
          tier: "MEMBER",
        },
      },
    },
  });

  await logAudit({
    action: "CLIENT_CREATED",
    entityType: "Client",
    entityId: client.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { firstName: rest.firstName, lastName: rest.lastName, phone: rest.phone },
  });

  revalidatePath("/dashboard/clients");
  await invalidateDashboardCache(authResult.salonId);
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
  const { salonId } = authResult;

  // Check for duplicate phone number if phone is provided
  if (normalizedPhone) {
    const existingClient = await prisma.client.findUnique({
      where: { salonId_phone: { salonId, phone: normalizedPhone } },
    });

    if (existingClient) {
      // Return existing client instead of creating duplicate
      return {
        success: true,
        data: { id: existingClient.id, firstName: existingClient.firstName }
      };
    }
  }
  // Phone-less walk-ins are always created as separate records — two walk-ins with the
  // same name can be different people, so we never merge them by name alone.

  const client = await prisma.client.create({
    data: {
      salonId,
      firstName,
      lastName: null,
      phone: normalizedPhone,
      isWalkIn: true,
      loyaltyPoints: {
        create: {
          salonId,
          balance: 0,
          tier: "MEMBER",
        },
      },
    },
  });

  await logAudit({
    action: "WALKIN_CLIENT_CREATED",
    entityType: "Client",
    entityId: client.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { firstName, phone: normalizedPhone },
  });

  revalidatePath("/dashboard/clients");
  await invalidateDashboardCache(authResult.salonId);
  return { success: true, data: { id: client.id, firstName: client.firstName } };
}

// Add a client inline during booking. Name required; last/phone/email optional. Unlike a
// walk-in record this is a normal client (isWalkIn=false) — "walk-in" is a visit mode now.
// De-dupes by phone (returns the existing client) so booking the same number twice is safe.
export async function createBookingClient(data: BookingClientData): Promise<ActionResult<{ id: string; firstName: string }>> {
  const authResult = await checkAuth("clients:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = bookingClientSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { firstName, lastName, phone, email } = validationResult.data;
  const normalizedPhone = phone && phone.trim() !== "" ? phone : null;
  const { salonId } = authResult;

  if (normalizedPhone) {
    const existingClient = await prisma.client.findUnique({
      where: { salonId_phone: { salonId, phone: normalizedPhone } },
    });
    if (existingClient) {
      return { success: true, data: { id: existingClient.id, firstName: existingClient.firstName } };
    }
  }

  const client = await prisma.client.create({
    data: {
      salonId,
      firstName,
      lastName: lastName && lastName.trim() !== "" ? lastName.trim() : null,
      phone: normalizedPhone,
      email: email && email.trim() !== "" ? email.trim() : null,
      isWalkIn: false,
      loyaltyPoints: { create: { salonId, balance: 0, tier: "MEMBER" } },
    },
  });

  await logAudit({
    action: "CLIENT_CREATED",
    entityType: "Client",
    entityId: client.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { firstName, phone: normalizedPhone },
  });

  revalidatePath("/dashboard/clients");
  await invalidateDashboardCache(authResult.salonId);
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

  const { id, birthday, email, photoUrl, ...rest } = validationResult.data;

  // Check if client exists and belongs to the organization
  const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
  const existingClient = await prisma.client.findFirst({
    where: { id, salonId: { in: orgSalonIds } },
  });

  if (!existingClient) {
    return { success: false, error: "Client not found" };
  }

  // Check for duplicate phone number if phone is being updated (at client's home branch)
  if (rest.phone && rest.phone !== existingClient.phone) {
    const duplicatePhone = await prisma.client.findUnique({
      where: { salonId_phone: { salonId: existingClient.salonId, phone: rest.phone } },
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
      ...(photoUrl !== undefined && { photoUrl: photoUrl || null }),
      ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
    },
  });

  const changes: Record<string, { from: string | null; to: string | null }> = {};
  if (rest.firstName !== undefined && rest.firstName !== existingClient.firstName) changes.firstName = { from: existingClient.firstName, to: rest.firstName };
  if (rest.lastName !== undefined && rest.lastName !== existingClient.lastName) changes.lastName = { from: existingClient.lastName, to: rest.lastName };
  if (rest.phone !== undefined && rest.phone !== existingClient.phone) changes.phone = { from: existingClient.phone, to: rest.phone };
  if (email !== undefined && (email || null) !== existingClient.email) changes.email = { from: existingClient.email, to: email || null };

  await logAudit({
    action: "CLIENT_UPDATED",
    entityType: "Client",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: changes,
  });

  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${id}`);
  await invalidateDashboardCache(authResult.salonId);
  return { success: true, data: undefined };
}

// Booking context strip: the at-a-glance info shown next to the client picker while
// booking. Fetched on demand for the SELECTED client only (not preloaded for the whole
// list) so it scales to salons with thousands of clients.
//
// Every field degrades gracefully to nothing when it doesn't apply, so a salon that has
// turned off loyalty (module OFF or program disabled) simply shows no tier/points chip,
// a brand-new client shows "New" instead of a last-visit date, and so on.
export interface ClientBookingContext {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  allergies: string | null;
  // null when loyalty is unavailable for this salon (module OFF or program disabled);
  // the caller then renders no tier/points chip at all.
  loyalty: { tier: LoyaltyTier; points: number } | null;
  lastVisit: string | null; // ISO date of the most recent completed visit; null = first-timer
  noShowCount: number; // past no-shows — a cue to consider a deposit
}

export async function getClientBookingContext(
  clientId: string
): Promise<ActionResult<ClientBookingContext>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
  const client = await prisma.client.findFirst({
    where: { id: clientId, salonId: { in: orgSalonIds } },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      allergies: true,
      loyaltyPoints: { select: { tier: true, balance: true } },
    },
  });
  if (!client) {
    return { success: false, error: "Client not found" };
  }

  // Loyalty is shown only when it's actually active for this salon: the module must be
  // enabled AND the owner must not have switched the program off in Settings.
  const [loyaltyModuleOn, settings, lastVisitAppt, noShowCount] = await Promise.all([
    isModuleEnabled(authResult.salonId, "loyalty"),
    prisma.settings.findUnique({
      where: { salonId: authResult.salonId },
      select: { loyaltyProgramEnabled: true },
    }),
    prisma.appointment.findFirst({
      where: { clientId, status: AppointmentStatus.COMPLETED },
      orderBy: { startTime: "desc" },
      select: { startTime: true },
    }),
    prisma.appointment.count({
      where: { clientId, status: AppointmentStatus.NO_SHOW },
    }),
  ]);
  const loyaltyEnabled = loyaltyModuleOn && (settings?.loyaltyProgramEnabled ?? true);

  return {
    success: true,
    data: {
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      email: client.email,
      allergies: client.allergies,
      loyalty: loyaltyEnabled && client.loyaltyPoints
        ? { tier: client.loyaltyPoints.tier, points: client.loyaltyPoints.balance }
        : null,
      lastVisit: lastVisitAppt ? lastVisitAppt.startTime.toISOString() : null,
      noShowCount,
    },
  };
}

export async function deleteClient(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("clients:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Allow deleting clients from any branch in the org
  const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
  const client = await prisma.client.findFirst({
    where: { id, salonId: { in: orgSalonIds } },
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

  await logAudit({
    action: "CLIENT_DELETED",
    entityType: "Client",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { firstName: client.firstName, lastName: client.lastName },
  });

  revalidatePath("/dashboard/clients");
  await invalidateDashboardCache(authResult.salonId);
  return { success: true, data: undefined };
}

export async function restoreClient(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("clients:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
  const client = await prisma.client.findFirst({
    where: { id, salonId: { in: orgSalonIds } },
  });

  if (!client) {
    return { success: false, error: "Client not found" };
  }

  await prisma.client.update({
    where: { id },
    data: { isActive: true },
  });

  await logAudit({
    action: "CLIENT_RESTORED",
    entityType: "Client",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { firstName: client.firstName, lastName: client.lastName },
  });

  revalidatePath("/dashboard/clients");
  await invalidateDashboardCache(authResult.salonId);
  return { success: true, data: undefined };
}

export async function getAllTags(): Promise<ActionResult<string[]>> {
  const authResult = await checkAuth("clients:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    const clients = await prisma.client.findMany({
      select: { tags: true },
      where: { salonId: { in: orgSalonIds }, isActive: true },
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
