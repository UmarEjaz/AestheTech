"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { cacheGet, cacheSet } from "@/lib/redis";

// Platform dashboard stats are expensive (14 parallel aggregates) and tolerate
// slight staleness — cache briefly. No-ops gracefully when Redis isn't configured.
const PLATFORM_STATS_CACHE_KEY = "platform:stats";
const PLATFORM_STATS_TTL = 60; // seconds

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
    users: number;
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
  users: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string | null;       // Slug (e.g., "owner") — for matching/logic
    roleName: string | null;   // Display name (e.g., "Owner") — for UI
    roleColor: string | null;  // Hex color (e.g., "#9333EA") — for badge styling
    isActive: boolean;
    createdAt: Date;
  }[];
};

// ============================================
// SUPER_ADMIN Salon Management Actions
// ============================================

/**
 * Get all salons (SUPER_ADMIN only).
 */
export async function getSalons(): Promise<ActionResult<SalonListItem[]>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
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
          select: { users: true },
        },
      },
    });

    return { success: true, data: salons };
  } catch {
    return { success: false, error: "Failed to fetch salons" };
  }
}

// ============================================
// Platform dashboard (SUPER_ADMIN only)
// ============================================

export type PlatformStats = {
  // Tenants
  totalSalons: number;
  activeSalons: number;
  inactiveSalons: number;
  rootSalons: number; // top-level orgs (no parent)
  branchSalons: number; // child branches
  newSalonsThisMonth: number;
  // Subscriptions
  subscriptionStatus: { active: number; trial: number; suspended: number; cancelled: number; other: number };
  subscriptionPlan: { basic: number; pro: number; enterprise: number; none: number };
  // People
  totalUsers: number; // tenant users (excludes super admins)
  newUsersThisMonth: number;
  totalClients: number;
  // Activity (platform-wide, last 30 days)
  salesLast30dCount: number;
  salesLast30dRevenue: number;
  appointmentsLast30d: number;
  // Support / impersonation
  activeImpersonationSessions: number;
  impersonationsLast30d: number;
  // Recent tenants for the table
  recentSalons: {
    id: string;
    name: string;
    subscriptionStatus: string;
    subscriptionPlan: string | null;
    isActive: boolean;
    createdAt: Date;
    userCount: number;
  }[];
};

/**
 * Aggregate platform-wide metrics for the super admin dashboard. All figures are
 * real (computed from the DB). Returns the org currency-agnostic numeric revenue;
 * the page formats it.
 */
export async function getPlatformStats(): Promise<ActionResult<PlatformStats>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Serve a recent cached snapshot if available (short TTL — tolerates staleness).
    const cached = await cacheGet<PlatformStats>(PLATFORM_STATS_CACHE_KEY);
    if (cached) {
      return { success: true, data: cached };
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalSalons,
      activeSalons,
      rootSalons,
      newSalonsThisMonth,
      statusGroups,
      planGroups,
      totalUsers,
      newUsersThisMonth,
      totalClients,
      salesAgg,
      appointmentsLast30d,
      activeImpersonationSessions,
      impersonationsLast30d,
      recentSalonsRaw,
    ] = await Promise.all([
      prisma.salon.count(),
      prisma.salon.count({ where: { isActive: true } }),
      prisma.salon.count({ where: { parentSalonId: null } }),
      prisma.salon.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.salon.groupBy({ by: ["subscriptionStatus"], _count: { _all: true } }),
      prisma.salon.groupBy({ by: ["subscriptionPlan"], _count: { _all: true } }),
      prisma.user.count({ where: { isSuperAdmin: false } }),
      prisma.user.count({ where: { isSuperAdmin: false, createdAt: { gte: startOfMonth } } }),
      prisma.client.count(),
      prisma.sale.aggregate({
        where: { createdAt: { gte: last30d } },
        _count: { _all: true },
        _sum: { finalAmount: true },
      }),
      prisma.appointment.count({ where: { createdAt: { gte: last30d } } }),
      prisma.impersonationSession.count({
        where: { endedAt: null, expiresAt: { gt: now } },
      }),
      prisma.impersonationSession.count({ where: { startedAt: { gte: last30d } } }),
      prisma.salon.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          name: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          isActive: true,
          createdAt: true,
          _count: { select: { users: true } },
        },
      }),
    ]);

    const statusCount = (s: string) =>
      statusGroups.find((g) => g.subscriptionStatus === s)?._count._all ?? 0;
    const planCount = (p: string) =>
      planGroups.find((g) => g.subscriptionPlan === p)?._count._all ?? 0;
    const knownStatuses = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"];

    const stats: PlatformStats = {
      totalSalons,
      activeSalons,
      inactiveSalons: totalSalons - activeSalons,
      rootSalons,
      branchSalons: totalSalons - rootSalons,
      newSalonsThisMonth,
      subscriptionStatus: {
        active: statusCount("ACTIVE"),
        trial: statusCount("TRIAL"),
        suspended: statusCount("SUSPENDED"),
        cancelled: statusCount("CANCELLED"),
        other: statusGroups
          .filter((g) => !knownStatuses.includes(g.subscriptionStatus))
          .reduce((sum, g) => sum + g._count._all, 0),
      },
      subscriptionPlan: {
        basic: planCount("BASIC"),
        pro: planCount("PRO"),
        enterprise: planCount("ENTERPRISE"),
        none: planGroups
          .filter((g) => g.subscriptionPlan === null)
          .reduce((sum, g) => sum + g._count._all, 0),
      },
      totalUsers,
      newUsersThisMonth,
      totalClients,
      salesLast30dCount: salesAgg._count._all,
      salesLast30dRevenue: Number(salesAgg._sum.finalAmount ?? 0),
      appointmentsLast30d,
      activeImpersonationSessions,
      impersonationsLast30d,
      recentSalons: recentSalonsRaw.map((s) => ({
        id: s.id,
        name: s.name,
        subscriptionStatus: s.subscriptionStatus,
        subscriptionPlan: s.subscriptionPlan,
        isActive: s.isActive,
        createdAt: s.createdAt,
        userCount: s._count.users,
      })),
    };

    await cacheSet(PLATFORM_STATS_CACHE_KEY, stats, PLATFORM_STATS_TTL);

    return { success: true, data: stats };
  } catch (error) {
    console.error("Failed to compute platform stats:", error);
    return { success: false, error: "Failed to load platform statistics" };
  }
}

/**
 * Get a single salon by ID with its users (SUPER_ADMIN only).
 */
export async function getSalonById(
  id: string
): Promise<ActionResult<SalonDetail>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id },
      include: {
        users: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            roleDefinitionId: true,
            roleDefinition: { select: { slug: true, name: true, color: true } },
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    if (!salon) {
      return { success: false, error: "Salon not found" };
    }

    // Map users to include role name from roleDefinition relation
    const mappedSalon: SalonDetail = {
      ...salon,
      users: salon.users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        role: u.roleDefinition?.slug ?? null,
        roleName: u.roleDefinition?.name ?? null,
        roleColor: u.roleDefinition?.color ?? null,
        isActive: u.isActive,
        createdAt: u.createdAt,
      })),
    };

    return { success: true, data: mappedSalon };
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
  if (!session?.user?.isPlatformAdmin) {
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

    // Create salon + settings + per-salon roles + permissions atomically so a failure
    // at any step rolls back everything. Prevents a half-built salon with rows but
    // no permissions seeded.
    const { seedDefaultSalonRoles } = await import("@/lib/actions/role");
    const { seedPermissionsForSalon } = await import("@/lib/seed-permissions");
    const salon = await prisma.$transaction(async (tx) => {
      const newSalon = await tx.salon.create({
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

      // Owner stays global; only Admin/Staff/Receptionist are created per-salon.
      await seedDefaultSalonRoles(newSalon.id, tx);
      await seedPermissionsForSalon(newSalon.id, tx);

      return newSalon;
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

// ============================================
// Staff seat limit (SUPER_ADMIN only)
// ============================================

/**
 * Set the organization staff-seat limit. The limit is stored on the org-ROOT
 * salon and applies to the whole organization (root + branches). Passing null
 * (or a non-positive number) clears the limit (unlimited).
 */
export async function setSalonMaxStaff(
  salonId: string,
  maxStaff: number | null
): Promise<ActionResult<{ maxStaff: number | null }>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, parentSalonId: true },
  });
  if (!salon) {
    return { success: false, error: "Salon not found" };
  }

  // Always store the limit on the org root so branches inherit it.
  const rootId = salon.parentSalonId ?? salon.id;
  // Floor first, THEN check > 0, so fractional inputs like 0.5 become null
  // (unlimited) rather than flooring to a hard 0-seat cap.
  const floored = maxStaff != null && Number.isFinite(maxStaff) ? Math.floor(maxStaff) : null;
  const normalized = floored != null && floored > 0 ? floored : null;

  try {
    await prisma.salon.update({
      where: { id: rootId },
      data: { maxStaff: normalized },
    });

    await logAudit({
      action: "SALON_MAX_STAFF_UPDATED",
      entityType: "Salon",
      entityId: rootId,
      userId: session.user.id,
      userRole: "SUPER_ADMIN",
      salonId: null,
      isPlatformAction: true,
      details: { maxStaff: normalized },
    });
  } catch (error) {
    console.error("Failed to update staff limit:", error);
    return { success: false, error: "Failed to update staff limit" };
  }

  return { success: true, data: { maxStaff: normalized } };
}
