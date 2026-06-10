"use server";

import { prisma } from "@/lib/prisma";
import { getOrgRootSalonId, getOrganizationSalonIds } from "./branch";

export interface StaffUsage {
  /** Distinct active staff (org-wide, excluding super admins). */
  used: number;
  /** Org seat limit (from the org-root salon); null = unlimited. */
  limit: number | null;
  /** True when a new seat can still be added. */
  canAdd: boolean;
}

/**
 * Count distinct active staff across the whole organization (root + branches),
 * excluding platform super admins, and compare to the org's seat limit.
 *
 * Seats are counted per-organization (industry standard for tier-based billing):
 * a person who belongs to multiple branches counts once.
 */
export async function getStaffUsage(salonId: string): Promise<StaffUsage> {
  const rootId = await getOrgRootSalonId(salonId);
  const [root, orgSalonIds] = await Promise.all([
    prisma.salon.findUnique({ where: { id: rootId }, select: { maxStaff: true } }),
    getOrganizationSalonIds(salonId),
  ]);

  const limit = root?.maxStaff ?? null;

  // Distinct, active, non-super-admin users with membership anywhere in the org.
  const members = await prisma.userSalon.findMany({
    where: {
      salonId: { in: orgSalonIds },
      isActive: true,
      user: { isActive: true, isSuperAdmin: false },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const used = members.length;
  const canAdd = limit === null || used < limit;
  return { used, limit, canAdd };
}

/**
 * Whether the org has room for one more NEW staff member. Used to gate staff
 * creation. `excludeUserId` lets transfer flows ignore a user who is already an
 * org member (moving them between branches doesn't consume a new seat).
 */
export async function canAddStaff(salonId: string, excludeUserId?: string): Promise<boolean> {
  const { limit } = await getStaffUsage(salonId);
  if (limit === null) return true;

  const orgSalonIds = await getOrganizationSalonIds(salonId);
  const members = await prisma.userSalon.findMany({
    where: {
      salonId: { in: orgSalonIds },
      isActive: true,
      user: { isActive: true, isSuperAdmin: false },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  return members.length < limit;
}
