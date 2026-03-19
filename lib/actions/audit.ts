"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { Role, Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";

interface LogAuditParams {
  action: string;
  entityType: string;
  entityId?: string | null;
  userId: string;
  userRole: string;
  salonId?: string | null;
  details?: Prisma.InputJsonValue | null;
}

/**
 * Log an audit event. Fire-and-forget — never throws.
 */
export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        userId: params.userId,
        userRole: params.userRole,
        salonId: params.salonId ?? null,
        details: params.details ?? undefined,
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
}

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userRole: string;
  details: unknown;
  createdAt: Date;
  user: {
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
  if (!session.user.salonRole) return { success: false, error: "Unauthorized" };

  const role = session.user.salonRole as Role;
  if (!hasPermission(role, "audit:view")) {
    return { success: false, error: "Unauthorized" };
  }

  const salonId = session.user.salonId;

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (salonId) {
    where.salonId = salonId;
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
export async function getAuditActions(): Promise<ActionResult<string[]>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  if (!session.user.salonRole) return { success: false, error: "Unauthorized" };

  const role = session.user.salonRole as Role;
  if (!hasPermission(role, "audit:view")) {
    return { success: false, error: "Unauthorized" };
  }

  const salonId = session.user.salonId;

  try {
    const results = await prisma.auditLog.findMany({
      where: salonId ? { salonId } : undefined,
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
export async function getAuditEntityTypes(): Promise<ActionResult<string[]>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  if (!session.user.salonRole) return { success: false, error: "Unauthorized" };

  const role = session.user.salonRole as Role;
  if (!hasPermission(role, "audit:view")) {
    return { success: false, error: "Unauthorized" };
  }

  const salonId = session.user.salonId;

  try {
    const results = await prisma.auditLog.findMany({
      where: salonId ? { salonId } : undefined,
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    });
    return { success: true, data: results.map((r) => r.entityType) };
  } catch {
    return { success: false, error: "Failed to fetch entity types" };
  }
}
