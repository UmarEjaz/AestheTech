"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

// ============================================
// Types
// ============================================

export type SalonListItem = {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: {
    members: number;
  };
};

export type SalonDetail = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  members: {
    id: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
    };
  }[];
};

export type UserSalon = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  subscriptionStatus: string;
  role: string;
};

// ============================================
// Salon Switcher Actions
// ============================================

/**
 * Get all salons the current user belongs to (for the salon switcher).
 */
export async function getUserSalons(): Promise<ActionResult<UserSalon[]>> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const memberships = await prisma.salonMember.findMany({
      where: {
        userId: session.user.id,
        isActive: true,
        salon: { isActive: true },
      },
      include: {
        salon: {
          select: {
            id: true,
            name: true,
            slug: true,
            address: true,
            subscriptionStatus: true,
          },
        },
      },
      orderBy: {
        salon: { name: "asc" },
      },
    });

    const salons: UserSalon[] = memberships.map((m) => ({
      id: m.salon.id,
      name: m.salon.name,
      slug: m.salon.slug,
      address: m.salon.address,
      subscriptionStatus: m.salon.subscriptionStatus,
      role: m.role,
    }));

    return { success: true, data: salons };
  } catch {
    return { success: false, error: "Failed to fetch salons" };
  }
}

/**
 * Switch the current user's active salon. Returns the new salonId and role
 * so the client can call `update()` on the NextAuth session.
 */
export async function switchSalon(
  salonId: string
): Promise<ActionResult<{ salonId: string; salonRole: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const membership = await prisma.salonMember.findUnique({
      where: {
        userId_salonId: {
          userId: session.user.id,
          salonId,
        },
      },
      include: {
        salon: { select: { isActive: true } },
      },
    });

    if (!membership || !membership.isActive || !membership.salon.isActive) {
      return { success: false, error: "You do not have access to this salon" };
    }

    return {
      success: true,
      data: {
        salonId: membership.salonId,
        salonRole: membership.role,
      },
    };
  } catch {
    return { success: false, error: "Failed to switch salon" };
  }
}

// ============================================
// SUPER_ADMIN Salon Management Actions
// ============================================

/**
 * Get all salons (SUPER_ADMIN only).
 */
export async function getSalons(): Promise<ActionResult<SalonListItem[]>> {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salons = await prisma.salon.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { members: true },
        },
      },
    });

    return { success: true, data: salons };
  } catch {
    return { success: false, error: "Failed to fetch salons" };
  }
}

/**
 * Get a single salon by ID with its members (SUPER_ADMIN only).
 */
export async function getSalonById(
  id: string
): Promise<ActionResult<SalonDetail>> {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!salon) {
      return { success: false, error: "Salon not found" };
    }

    return { success: true, data: salon };
  } catch {
    return { success: false, error: "Failed to fetch salon" };
  }
}

/**
 * Create a new salon (SUPER_ADMIN only).
 */
export async function createSalon(data: {
  name: string;
  slug: string;
  email?: string;
  phone?: string;
  address?: string;
  subscriptionPlan?: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Check slug uniqueness
    const existing = await prisma.salon.findUnique({
      where: { slug: data.slug },
    });
    if (existing) {
      return { success: false, error: "A salon with this slug already exists" };
    }

    const salon = await prisma.salon.create({
      data: {
        name: data.name,
        slug: data.slug,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        subscriptionPlan: data.subscriptionPlan || null,
        subscriptionStatus: "TRIAL",
        settings: {
          create: {
            salonName: data.name,
            salonEmail: data.email || null,
            salonPhone: data.phone || null,
            salonAddress: data.address || null,
          },
        },
      },
    });

    await logAudit({
      action: "SALON_CREATED",
      entityType: "Salon",
      entityId: salon.id,
      userId: session.user.id,
      userRole: "SUPER_ADMIN",
      salonId: null,
      details: { name: data.name, slug: data.slug },
    });

    revalidatePath("/admin/salons");

    return { success: true, data: { id: salon.id } };
  } catch {
    return { success: false, error: "Failed to create salon" };
  }
}
