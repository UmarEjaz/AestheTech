"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit";
import { SYSTEM_ROLES } from "@/lib/roles";
import { ActionResult, ActiveImpersonation } from "@/lib/types";

/** Default support-session lifetime (time-box). */
const IMPERSONATION_TTL_MINUTES = 60;

async function requireSuperAdmin() {
  const session = await auth();
  // Real platform identity — stays true even while acting as a tenant user, so
  // the operator can always switch sessions or exit.
  if (!session?.user?.isPlatformAdmin) return null;
  return session.user;
}

/**
 * End every open session for this impersonator (there should be at most one).
 * Optionally writes IMPERSONATION_END audit rows.
 */
async function closeActiveSessions(
  impersonatorUserId: string,
  opts: { audit: boolean }
): Promise<void> {
  const active = await prisma.impersonationSession.findMany({
    where: { impersonatorUserId, endedAt: null },
  });
  if (active.length === 0) return;

  await prisma.impersonationSession.updateMany({
    where: { impersonatorUserId, endedAt: null },
    data: { endedAt: new Date() },
  });

  if (opts.audit) {
    for (const s of active) {
      await logAudit({
        action: "IMPERSONATION_END",
        entityType: "ImpersonationSession",
        entityId: s.id,
        userId: impersonatorUserId,
        userRole: "SUPER_ADMIN",
        salonId: s.salonId,
        isPlatformAction: true,
        details: { mode: s.mode, actingAsUserId: s.actingAsUserId },
      });
    }
  }
}

/**
 * "Enter salon" — PLATFORM mode. Super admin enters a tenant salon with full,
 * unrestricted access (nothing hidden). Returns the new session id; the client
 * must call the NextAuth `update({ impersonation: { sessionId } })` to activate it.
 */
export async function enterSalon(
  salonId: string,
  reason?: string
): Promise<ActionResult<{ sessionId: string; expiresAt: string }>> {
  const sa = await requireSuperAdmin();
  if (!sa) return { success: false, error: "Unauthorized" };

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, isActive: true },
  });
  if (!salon || !salon.isActive) {
    return { success: false, error: "Salon not found or inactive" };
  }

  await closeActiveSessions(sa.id, { audit: true });

  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000);
  const session = await prisma.impersonationSession.create({
    data: {
      impersonatorUserId: sa.id,
      salonId,
      actingAsUserId: null,
      mode: "PLATFORM",
      reason: reason ?? null,
      expiresAt,
    },
  });

  await logAudit({
    action: "IMPERSONATION_START",
    entityType: "ImpersonationSession",
    entityId: session.id,
    userId: sa.id,
    userRole: "SUPER_ADMIN",
    salonId,
    isPlatformAction: true,
    details: { mode: "PLATFORM", expiresAt: expiresAt.toISOString() },
  });

  return { success: true, data: { sessionId: session.id, expiresAt: expiresAt.toISOString() } };
}

/**
 * "Login as <user>" — AS_USER mode. Super admin sees exactly what the target
 * tenant user sees (their role + permission overrides). The target must be an
 * active member of the salon and must not be a super admin.
 */
export async function loginAsUser(
  salonId: string,
  targetUserId: string,
  reason?: string
): Promise<ActionResult<{ sessionId: string; expiresAt: string }>> {
  const sa = await requireSuperAdmin();
  if (!sa) return { success: false, error: "Unauthorized" };

  const membership = await prisma.userSalon.findUnique({
    where: { userId_salonId: { userId: targetUserId, salonId } },
    include: {
      salon: { select: { isActive: true } },
      user: { select: { isSuperAdmin: true, isActive: true } },
    },
  });

  if (!membership || !membership.isActive || !membership.salon.isActive) {
    return { success: false, error: "Target user is not an active member of this salon" };
  }
  if (membership.user.isSuperAdmin) {
    return { success: false, error: "Cannot impersonate another super admin" };
  }
  if (!membership.user.isActive) {
    return { success: false, error: "Target user is inactive" };
  }

  await closeActiveSessions(sa.id, { audit: true });

  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000);
  const session = await prisma.impersonationSession.create({
    data: {
      impersonatorUserId: sa.id,
      salonId,
      actingAsUserId: targetUserId,
      mode: "AS_USER",
      reason: reason ?? null,
      expiresAt,
    },
  });

  await logAudit({
    action: "IMPERSONATION_START",
    entityType: "ImpersonationSession",
    entityId: session.id,
    userId: sa.id,
    userRole: "SUPER_ADMIN",
    salonId,
    isPlatformAction: true,
    details: { mode: "AS_USER", actingAsUserId: targetUserId, expiresAt: expiresAt.toISOString() },
  });

  return { success: true, data: { sessionId: session.id, expiresAt: expiresAt.toISOString() } };
}

/**
 * "Login as Owner" — convenience over loginAsUser that resolves the salon's owner.
 */
export async function loginAsOwner(
  salonId: string,
  reason?: string
): Promise<ActionResult<{ sessionId: string; expiresAt: string }>> {
  const sa = await requireSuperAdmin();
  if (!sa) return { success: false, error: "Unauthorized" };

  const ownerMembership = await prisma.userSalon.findFirst({
    where: {
      salonId,
      isActive: true,
      roleDefinition: { slug: SYSTEM_ROLES.OWNER },
      user: { isActive: true, isSuperAdmin: false },
    },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });

  if (!ownerMembership) {
    return { success: false, error: "This salon has no active owner to log in as" };
  }

  return loginAsUser(salonId, ownerMembership.userId, reason);
}

/**
 * Exit the current support session and return to the platform plane. The client
 * must follow with `update({ impersonation: null })`.
 */
export async function exitImpersonation(): Promise<ActionResult<{ ended: boolean }>> {
  const sa = await requireSuperAdmin();
  if (!sa) return { success: false, error: "Unauthorized" };

  await closeActiveSessions(sa.id, { audit: true });
  return { success: true, data: { ended: true } };
}

/**
 * Read the current active impersonation (for the banner / UI), validated against
 * the DB so a stale token can't keep a revoked or expired session "alive".
 */
export async function getActiveImpersonation(): Promise<ActionResult<ActiveImpersonation | null>> {
  const session = await auth();
  if (!session?.user?.isPlatformAdmin) return { success: false, error: "Unauthorized" };

  const sessionId = session.user.impersonation?.sessionId;
  if (!sessionId) return { success: true, data: null };

  const row = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    include: {
      salon: { select: { name: true } },
      actingAsUser: { select: { firstName: true, lastName: true } },
    },
  });

  if (
    !row ||
    row.impersonatorUserId !== session.user.id ||
    row.endedAt ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return { success: true, data: null };
  }

  return {
    success: true,
    data: {
      sessionId: row.id,
      mode: row.mode,
      salonId: row.salonId,
      salonName: row.salon.name,
      actingAsUserId: row.actingAsUserId,
      actingAsName: row.actingAsUser
        ? `${row.actingAsUser.firstName} ${row.actingAsUser.lastName}`
        : null,
      expiresAt: row.expiresAt.toISOString(),
    },
  };
}
