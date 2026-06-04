"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { getOrganizationSalonIds } from "./branch";

interface LogAuditParams {
  action: string;
  entityType: string;
  entityId?: string | null;
  userId: string;
  userRole: string;
  salonId?: string | null;
  details?: Prisma.InputJsonValue | null;
  /**
   * Real super admin behind the action (AS_USER mode). Usually left unset — when
   * omitted, it is auto-detected from an active impersonation session.
   */
  impersonatorId?: string | null;
  /**
   * Marks a support/platform action that is hidden from tenant-facing audit views.
   * When omitted, auto-detected from the caller's active impersonation session.
   */
  isPlatformAction?: boolean;
}

/**
 * Log an audit event. Fire-and-forget — never throws.
 *
 * When `isPlatformAction` is not provided, the caller's active impersonation
 * session (if any) is auto-detected so existing mutation call sites don't need
 * to know about impersonation: a super admin acting inside a tenant is recorded
 * as a hidden platform action, with the real actor preserved via impersonatorId.
 */
export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    let impersonatorId = params.impersonatorId ?? null;
    let isPlatformAction = params.isPlatformAction;

    if (isPlatformAction === undefined) {
      const session = await auth();
      if (session?.user?.impersonation) {
        isPlatformAction = true;
        // In AS_USER mode `userId` is the borrowed identity; record the real super admin.
        if (session.user.impersonation.mode === "AS_USER") {
          impersonatorId = session.user.id;
        }
      } else {
        isPlatformAction = false;
      }
    }

    await prisma.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        userId: params.userId,
        userRole: params.userRole,
        salonId: params.salonId ?? null,
        details: params.details ?? undefined,
        impersonatorId,
        isPlatformAction,
      },
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
}

interface GetAuditLogsParams {
  page?: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  userId?: string;
  from?: string;
  to?: string;
  branchFilter?: "current" | "all";
}

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userRole: string;
  details: unknown;
  createdAt: Date;
  isPlatformAction: boolean;
  user: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  impersonator: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

export async function getAuditLogs(
  params: GetAuditLogsParams = {}
): Promise<ActionResult<{ logs: AuditLogEntry[]; total: number; page: number; pageSize: number }>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  if (!session.user.salonRole && !session.user.isSuperAdmin) return { success: false, error: "Unauthorized" };

  const roleId = session.user.salonRoleId ?? null;
  const salonId = session.user.salonId;
  const userId = session.user.id;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!await hasPermission(roleId, "audit:view", isSuperAdmin, salonId, userId)) {
    return { success: false, error: "Unauthorized" };
  }

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  // Hide support/platform actions from tenant-facing viewers. Keyed on EFFECTIVE
  // access (isSuperAdmin) on purpose: in "Login as Owner" (AS_USER) mode this is
  // false, so the view stays 100% faithful to what the owner actually sees
  // (platform/support rows hidden). They are visible in "Enter salon" (PLATFORM)
  // mode, where isSuperAdmin is true.
  if (!isSuperAdmin) {
    where.isPlatformAction = false;
  }

  // Filter by current branch or all branches in the organization (data:all-branches required)
  if (salonId) {
    const canViewAllBranches = await hasPermission(roleId, "data:all-branches", isSuperAdmin, salonId, userId);
    if (params.branchFilter === "all" && canViewAllBranches) {
      const orgSalonIds = await getOrganizationSalonIds(salonId);
      where.salonId = { in: orgSalonIds };
    } else {
      where.salonId = salonId;
    }
  }

  if (params.action) {
    where.action = params.action;
  }
  if (params.entityType) {
    where.entityType = params.entityType;
  }
  if (params.userId) {
    where.userId = params.userId;
  }
  if (params.from || params.to) {
    const createdAt: Record<string, Date> = {};
    if (params.from) createdAt.gte = new Date(params.from);
    if (params.to) createdAt.lte = new Date(params.to);
    where.createdAt = createdAt;
  }

  try {
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          impersonator: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      success: true,
      data: { logs: logs as AuditLogEntry[], total, page, pageSize },
    };
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    return { success: false, error: "Failed to fetch audit logs" };
  }
}

/**
 * Get distinct action types for filter dropdown
 */
export async function getAuditActions(branchFilter: "current" | "all" = "current"): Promise<ActionResult<string[]>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  if (!session.user.salonRole && !session.user.isSuperAdmin) return { success: false, error: "Unauthorized" };

  const roleId = session.user.salonRoleId ?? null;
  const salonId = session.user.salonId;
  const userId = session.user.id;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!await hasPermission(roleId, "audit:view", isSuperAdmin, salonId, userId)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    let salonFilter: { salonId: string | { in: string[] } } | undefined;
    if (salonId) {
      const canViewAllBranches = await hasPermission(roleId, "data:all-branches", isSuperAdmin, salonId, userId);
      if (branchFilter === "all" && canViewAllBranches) {
        const orgSalonIds = await getOrganizationSalonIds(salonId);
        salonFilter = { salonId: { in: orgSalonIds } };
      } else {
        salonFilter = { salonId };
      }
    }
    const results = await prisma.auditLog.findMany({
      where: salonFilter,
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    return { success: true, data: results.map((r) => r.action) };
  } catch {
    return { success: false, error: "Failed to fetch audit actions" };
  }
}

/**
 * Get distinct entity types for filter dropdown
 */
export async function getAuditEntityTypes(branchFilter: "current" | "all" = "current"): Promise<ActionResult<string[]>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  if (!session.user.salonRole && !session.user.isSuperAdmin) return { success: false, error: "Unauthorized" };

  const roleId = session.user.salonRoleId ?? null;
  const salonId = session.user.salonId;
  const userId = session.user.id;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  if (!await hasPermission(roleId, "audit:view", isSuperAdmin, salonId, userId)) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    let salonFilter: { salonId: string | { in: string[] } } | undefined;
    if (salonId) {
      const canViewAllBranches = await hasPermission(roleId, "data:all-branches", isSuperAdmin, salonId, userId);
      if (branchFilter === "all" && canViewAllBranches) {
        const orgSalonIds = await getOrganizationSalonIds(salonId);
        salonFilter = { salonId: { in: orgSalonIds } };
      } else {
        salonFilter = { salonId };
      }
    }
    const results = await prisma.auditLog.findMany({
      where: salonFilter,
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    });
    return { success: true, data: results.map((r) => r.entityType) };
  } catch {
    return { success: false, error: "Failed to fetch entity types" };
  }
}
