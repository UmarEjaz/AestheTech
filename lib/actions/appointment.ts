"use server";

import { revalidatePath } from "next/cache";
import { TZDate } from "@date-fns/tz";
import { prisma } from "@/lib/prisma";
import { assertPaymentOwner } from "@/lib/payment-guards";
import { primaryStaffId } from "@/lib/utils/appointment";
import { checkAuth } from "@/lib/auth-helpers";
import {
  appointmentSchema,
  appointmentStatusSchema,
  rescheduleSchema,
  availableSlotsSchema,
  appointmentDepositSchema,
  AppointmentFormData,
  AppointmentStatusFormData,
  RescheduleFormData,
} from "@/lib/validations/appointment";
import { Prisma, AppointmentStatus, PaymentMethod } from "@prisma/client";
import { logAudit } from "./audit";
import { getSettings } from "./settings";
import { ActionResult } from "@/lib/types";
import { invalidateDashboardCache } from "@/lib/redis";
import { getOrganizationSalonIds } from "./branch";

// Include relations for appointment list
const appointmentListInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      isWalkIn: true,
      // Loyalty comes WITH the appointment so checkout never has to look the client up in a
      // separate (capped) list — the appointment fetch is the authoritative source.
      loyaltyPoints: true,
    },
  },
  // All services (1..N), each with its own staff + price/duration snapshot. order 0 = primary
  // provider (the source of truth — there is no denormalized appointment.staff to keep in sync).
  services: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      price: true,
      duration: true,
      service: { select: { id: true, name: true, points: true, category: { select: { id: true, name: true } } } },
      staff: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  series: {
    select: {
      id: true,
      pattern: true,
      customWeeks: true,
      isActive: true,
    },
  },
  // Deposits/prepayments taken against this appointment (applied at checkout).
  payments: {
    select: { id: true, amount: true, method: true, paidAt: true },
    orderBy: { paidAt: "asc" },
  },
  // The sale this appointment was checked out into (null until checked out).
  sale: { select: { id: true } },
});

export type AppointmentListItem = Prisma.AppointmentGetPayload<{
  include: typeof appointmentListInclude;
}>;

// Get appointments with filters
export async function getAppointments(params: {
  date?: Date;
  startDate?: Date;
  endDate?: Date;
  staffId?: string;
  clientId?: string;
  status?: AppointmentStatus;
  page?: number;
  limit?: number;
} = {}): Promise<ActionResult<{
  appointments: AppointmentListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { date, startDate, endDate, staffId, clientId, status, page = 1, limit = 50 } = params;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50;
  const skip = (safePage - 1) * safeLimit;

  // Build date filter
  let dateFilter: Prisma.DateTimeFilter | undefined;

  if (date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    dateFilter = { gte: dayStart, lte: dayEnd };
  } else if (startDate || endDate) {
    dateFilter = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;
  }

  const where: Prisma.AppointmentWhereInput = {
    salonId: authResult.salonId,
    ...(dateFilter && { startTime: dateFilter }),
    // Filter by any appointment where this staff member performs a service (primary or secondary).
    ...(staffId && { services: { some: { staffId } } }),
    ...(clientId && { clientId }),
    ...(status && { status }),
  };

  try {
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: appointmentListInclude,
        orderBy: { startTime: "asc" },
        skip,
        take: safeLimit,
      }),
      prisma.appointment.count({ where }),
    ]);

    return {
      success: true,
      data: {
        appointments,
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  } catch (error) {
    console.error("Error fetching appointments:", error);
    return { success: false, error: "Failed to fetch appointments" };
  }
}

// Get single appointment
export async function getAppointment(id: string): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      include: appointmentListInclude,
    });

    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }

    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error fetching appointment:", error);
    return { success: false, error: "Failed to fetch appointment" };
  }
}

// A service segment: one provider is busy for a specific slice of the appointment.
type Segment = { staffId: string; startMs: number; endMs: number };

// Compute per-service segments from ORDERED (staffId, duration) lines starting at startMs.
// Service i occupies [start + Σd[0..i-1], + d[i]) — so each provider is only busy for the slice
// they actually work, not the whole appointment.
function computeSegments(startMs: number, lines: { staffId: string; duration: number }[]): Segment[] {
  const segs: Segment[] = [];
  let offsetMs = 0;
  for (const line of lines) {
    const s = startMs + offsetMs;
    const e = s + line.duration * 60_000;
    segs.push({ staffId: line.staffId, startMs: s, endMs: e });
    offsetMs += line.duration * 60_000;
  }
  return segs;
}

// True if any provider in `segments` is already booked during their slice by another appointment.
// Each provider is checked ONLY for the time they actually work, compared against the other
// appointments' per-service segments — so multi-provider bookings never over-reserve, and no
// secondary provider is missed (which single-provider checks used to allow).
async function hasSegmentConflict(salonId: string, segments: Segment[], excludeId?: string): Promise<boolean> {
  if (segments.length === 0) return false;
  const staffIds = Array.from(new Set(segments.map((s) => s.staffId)));
  const windowStart = Math.min(...segments.map((s) => s.startMs));
  const windowEnd = Math.max(...segments.map((s) => s.endMs));

  const candidates = await prisma.appointment.findMany({
    where: {
      salonId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      services: { some: { staffId: { in: staffIds } } },
      startTime: { lt: new Date(windowEnd) },
      endTime: { gt: new Date(windowStart) },
    },
    select: {
      startTime: true,
      services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
    },
  });

  for (const c of candidates) {
    const otherSegs = computeSegments(c.startTime.getTime(), c.services);
    for (const a of segments) {
      for (const b of otherSegs) {
        // Same provider AND overlapping time slice → real conflict.
        if (a.staffId === b.staffId && a.startMs < b.endMs && a.endMs > b.startMs) {
          return true;
        }
      }
    }
  }
  return false;
}

type ResolvedService = { id: string; duration: number; price: Prisma.Decimal; isActive: boolean };

// Validate all services on an appointment and compute the total duration.
// Returns a map (serviceId -> row) so callers can snapshot price/duration per line.
async function resolveServices(
  services: { serviceId: string; staffId: string }[],
  orgSalonIds: string[]
): Promise<
  | { ok: true; totalDuration: number; serviceMap: Map<string, ResolvedService> }
  | { ok: false; error: string }
> {
  const ids = services.map((s) => s.serviceId);
  const rows = await prisma.service.findMany({
    where: { id: { in: ids }, salonId: { in: orgSalonIds } },
    select: { id: true, duration: true, price: true, isActive: true },
  });
  const serviceMap = new Map<string, ResolvedService>(rows.map((s) => [s.id, s]));

  let totalDuration = 0;
  for (const s of services) {
    const row = serviceMap.get(s.serviceId);
    if (!row) return { ok: false, error: "A selected service was not found" };
    if (!row.isActive) return { ok: false, error: "A selected service is not available" };
    totalDuration += row.duration;
  }

  return { ok: true, totalDuration, serviceMap };
}

// Verify every staff id is assigned to the branch, active, and a service provider.
async function verifyStaffProviders(
  staffIds: string[],
  salonId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = await prisma.userSalon.findMany({
    where: {
      userId: { in: staffIds },
      salonId,
      isActive: true,
      user: { isActive: true, isServiceProvider: true },
    },
    select: { userId: true },
  });
  const validIds = new Set(valid.map((v) => v.userId));
  for (const sid of staffIds) {
    if (!validIds.has(sid)) {
      return { ok: false, error: "Staff member not found, inactive, or not a service provider in this branch" };
    }
  }
  return { ok: true };
}

// Create appointment
export async function createAppointment(
  data: AppointmentFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { clientId, services, startTime, notes } = validationResult.data;
  // Primary provider = the first service's staff (denormalized onto the appointment).
  const primaryStaffId = services[0].staffId;

  try {
    // Get org salon IDs to validate cross-branch references within the organization
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    // Resolve every service for duration/price and validity
    const serviceResolution = await resolveServices(services, orgSalonIds);
    if (!serviceResolution.ok) {
      return { success: false, error: serviceResolution.error };
    }
    const { totalDuration, serviceMap } = serviceResolution;

    // Calculate end time from the total duration across all services
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Each provider must be free during the slice they actually work (per-service segments) —
    // so a multi-provider booking neither over-reserves nor lets a secondary provider double-book.
    const segments = computeSegments(
      startTime.getTime(),
      services.map((s) => ({ staffId: s.staffId, duration: serviceMap.get(s.serviceId)!.duration }))
    );
    if (await hasSegmentConflict(authResult.salonId, segments)) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));

    // Verify client exists and is active (org-scoped)
    const client = await prisma.client.findFirst({
      where: { id: clientId, salonId: { in: orgSalonIds } },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Verify EVERY involved staff member is assigned to this branch, active, and a service
    // provider. Defense-in-depth — the dropdowns filter, but a scripted client could submit anything.
    const staffCheck = await verifyStaffProviders(distinctStaffIds, authResult.salonId);
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }

    const appointment = await prisma.appointment.create({
      data: {
        salonId: authResult.salonId,
        clientId,
        startTime,
        endTime,
        notes: notes || null,
        status: "SCHEDULED",
        services: {
          create: services.map((s, i) => {
            const row = serviceMap.get(s.serviceId)!;
            return {
              salonId: authResult.salonId,
              serviceId: s.serviceId,
              staffId: s.staffId,
              price: row.price,
              duration: row.duration,
              order: i,
            };
          }),
        },
      },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_CREATED",
      entityType: "Appointment",
      entityId: appointment.id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId, staffId: primaryStaffId, startTime: startTime.toISOString(), services: services.length },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error creating appointment:", error);
    return { success: false, error: "Failed to create appointment" };
  }
}

// Update appointment
export async function updateAppointment(
  id: string,
  data: AppointmentFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { clientId, services, startTime, notes } = validationResult.data;
  const primaryStaffId = services[0].staffId;

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot update completed or cancelled appointments" };
    }

    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    // Resolve every service for duration/price and validity
    const serviceResolution = await resolveServices(services, orgSalonIds);
    if (!serviceResolution.ok) {
      return { success: false, error: serviceResolution.error };
    }
    const { totalDuration, serviceMap } = serviceResolution;

    // Calculate end time from the total duration across all services
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Verify client exists and is active (org-scoped)
    const client = await prisma.client.findFirst({
      where: { id: clientId, salonId: { in: orgSalonIds } },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Each provider must be free during their own service slice (excluding this appointment).
    const segments = computeSegments(
      startTime.getTime(),
      services.map((s) => ({ staffId: s.staffId, duration: serviceMap.get(s.serviceId)!.duration }))
    );
    if (await hasSegmentConflict(authResult.salonId, segments, id)) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));
    const staffCheck = await verifyStaffProviders(distinctStaffIds, authResult.salonId);
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        clientId,
        startTime,
        endTime,
        notes: notes || null,
        // Replace the whole service set
        services: {
          deleteMany: {},
          create: services.map((s, i) => {
            const row = serviceMap.get(s.serviceId)!;
            return {
              salonId: authResult.salonId,
              serviceId: s.serviceId,
              staffId: s.staffId,
              price: row.price,
              duration: row.duration,
              order: i,
            };
          }),
        },
      },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_UPDATED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId, staffId: primaryStaffId, startTime: startTime.toISOString(), services: services.length },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error updating appointment:", error);
    return { success: false, error: "Failed to update appointment" };
  }
}

// Update appointment status
export async function updateAppointmentStatus(
  id: string,
  data: AppointmentStatusFormData
): Promise<ActionResult<AppointmentListItem>> {
  // Cancellation requires the dedicated cancel permission
  const requiredPermission = data.status === "CANCELLED" ? "appointments:cancel" : "appointments:update";
  const authResult = await checkAuth(requiredPermission);
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentStatusSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: {
        status: true,
        startTime: true,
        endTime: true,
        services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    // Validate status transitions. NO_SHOW/CANCELLED can be reactivated back to
    // SCHEDULED ("undo no-show" / "reopen") so a late or returning client can still
    // be served and checked out.
    const validTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
      SCHEDULED: ["CONFIRMED", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: ["SCHEDULED"],
      NO_SHOW: ["SCHEDULED"],
    };

    const allowedNextStatuses = validTransitions[existing.status];
    if (!allowedNextStatuses.includes(validationResult.data.status)) {
      return {
        success: false,
        error: `Cannot change status from ${existing.status} to ${validationResult.data.status}`,
      };
    }

    // Reactivating a NO_SHOW/CANCELLED appointment: make sure the slot is still free
    // (it may have been given to someone else in the meantime).
    const isReactivation =
      (existing.status === "NO_SHOW" || existing.status === "CANCELLED") &&
      validationResult.data.status === "SCHEDULED";
    if (isReactivation) {
      // Every provider must be free during their own slice (all services, not just the primary).
      const hasConflict = await hasSegmentConflict(
        authResult.salonId,
        computeSegments(existing.startTime.getTime(), existing.services),
        id
      );
      if (hasConflict) {
        return {
          success: false,
          error: "That time slot is no longer free — reschedule the appointment to reactivate it.",
        };
      }
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status: validationResult.data.status },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_STATUS_CHANGED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { from: existing.status, to: validationResult.data.status },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error updating appointment status:", error);
    return { success: false, error: "Failed to update appointment status" };
  }
}

// Reschedule appointment
export async function rescheduleAppointment(
  id: string,
  data: RescheduleFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = rescheduleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { startTime, staffId: newStaffId } = validationResult.data;

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      include: { services: { orderBy: { order: "asc" }, select: { id: true, duration: true, order: true, staffId: true } } },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot reschedule completed or cancelled appointments" };
    }

    // The primary provider = the first service's staff. A crafted newStaffId could reassign the
    // appointment to an inactive, non-provider, or cross-branch user — verify before applying.
    const currentPrimary = primaryStaffId(existing.services);
    if (newStaffId && newStaffId !== currentPrimary) {
      const staffCheck = await verifyStaffProviders([newStaffId], authResult.salonId);
      if (!staffCheck.ok) {
        return { success: false, error: staffCheck.error };
      }
    }

    const staffId = newStaffId || currentPrimary;

    // End time spans the total duration of all services
    const totalDuration = existing.services.reduce((sum, s) => sum + s.duration, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Each provider must be free during their own service slice at the new time (this appointment
    // excluded). If the primary provider changed, its first service moves to the new staff.
    const rescheduleLines = existing.services.map((s, i) => ({
      staffId: i === 0 ? staffId : s.staffId,
      duration: s.duration,
    }));
    const hasConflict = await hasSegmentConflict(
      authResult.salonId,
      computeSegments(startTime.getTime(), rescheduleLines),
      id
    );
    if (hasConflict) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    // If the primary provider changed (dragged to a different staff lane), reassign the primary
    // service line to that staff — services are the source of truth for who does what.
    const primaryLine = existing.services[0];
    const movePrimary = primaryLine && staffId !== currentPrimary;

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        startTime,
        endTime,
        ...(movePrimary
          ? { services: { update: { where: { id: primaryLine.id }, data: { staffId } } } }
          : {}),
      },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_RESCHEDULED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { newStartTime: startTime.toISOString(), staffId },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error rescheduling appointment:", error);
    return { success: false, error: "Failed to reschedule appointment" };
  }
}

// Cancel appointment
export async function cancelAppointment(id: string): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:cancel");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED") {
      return { success: false, error: "Cannot cancel completed appointments" };
    }

    if (existing.status === "CANCELLED") {
      return { success: false, error: "Appointment is already cancelled" };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_CANCELLED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error cancelling appointment:", error);
    return { success: false, error: "Failed to cancel appointment" };
  }
}

// Delete appointment (permanent - admin only)
export async function deleteAppointment(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("appointments:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify appointment belongs to this salon before deleting
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: {
        id: true,
        clientId: true,
        startTime: true,
        services: { orderBy: { order: "asc" }, select: { staffId: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    // Real money may be held against this appointment as an un-applied deposit. Permanently
    // deleting would erase that record with no refund or trace, so refuse — the owner must
    // Cancel the appointment instead (which keeps the record and prompts a refund). Deposits
    // already applied to an invoice are safe: they stay owned by the invoice (appointmentId
    // is cleared to null on delete), never orphaned.
    const heldDeposit = await prisma.payment.aggregate({
      where: { appointmentId: id, invoiceId: null },
      _sum: { amount: true },
    });
    if (Number(heldDeposit._sum.amount ?? 0) > 0) {
      return {
        success: false,
        error: "This appointment has a held deposit. Cancel it and refund the deposit before deleting.",
      };
    }

    await prisma.appointment.delete({ where: { id } });

    await logAudit({
      action: "APPOINTMENT_DELETED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId: existing.clientId, staffId: primaryStaffId(existing.services), startTime: existing.startTime },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting appointment:", error);
    return { success: false, error: "Failed to delete appointment" };
  }
}

// Get available time slots for an appointment on a given date. Takes the ordered service→staff
// assignments so slots are validated per-provider-per-segment (a slot is offered only when every
// provider is free during the exact slice they'd work), matching createAppointment.
export async function getAvailableSlots(params: {
  assignments: { serviceId: string; staffId: string }[];
  date: Date;
  excludeAppointmentId?: string; // Exclude this appointment from conflict check (for edit mode)
}): Promise<ActionResult<{ startTime: Date; endTime: Date }[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validated = availableSlotsSchema.safeParse(params);
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message };
  }
  const { assignments, date, excludeAppointmentId } = validated.data;
  const allStaffIds = Array.from(new Set(assignments.map((a) => a.staffId)));

  try {
    // Resolve durations and build ordered (staffId, duration) lines for segment math (org-scoped).
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    const serviceRows = await prisma.service.findMany({
      where: { id: { in: assignments.map((a) => a.serviceId) }, salonId: { in: orgSalonIds } },
      select: { id: true, duration: true },
    });
    const durationById = new Map(serviceRows.map((s) => [s.id, s.duration]));
    const lines: { staffId: string; duration: number }[] = [];
    let totalDuration = 0;
    for (const a of assignments) {
      const d = durationById.get(a.serviceId);
      if (d === undefined) {
        return { success: false, error: "Service not found" };
      }
      lines.push({ staffId: a.staffId, duration: d });
      totalDuration += d;
    }

    // Get business hours from settings
    const settingsResult = await getSettings();
    const settings = settingsResult.success
      ? settingsResult.data
      : { businessHoursStart: "09:00", businessHoursEnd: "19:00", timezone: "UTC", appointmentInterval: 30 };
    const tz = settings.timezone || "UTC";
    // Honor the salon's configured booking interval (default 30 min). Round to whole minutes and
    // clamp to the allowed 15–120 range so a bad stored value can't break the slot list.
    const slotInterval = Math.min(120, Math.max(15, Math.round(settings.appointmentInterval) || 30));

    // Parse business hours (format: "HH:MM") with validation and fallback
    const parseTime = (timeStr: string, defaultHour: number, defaultMin: number): [number, number] => {
      const parts = timeStr?.split(":");
      if (!parts || parts.length !== 2) return [defaultHour, defaultMin];
      const hour = parseInt(parts[0], 10);
      const min = parseInt(parts[1], 10);
      if (isNaN(hour) || isNaN(min) || hour < 0 || hour > 23 || min < 0 || min > 59) {
        return [defaultHour, defaultMin];
      }
      return [hour, min];
    };

    const [startHour, startMin] = parseTime(settings.businessHoursStart, 9, 0);
    const [endHour, endMin] = parseTime(settings.businessHoursEnd, 19, 0);

    // Build the day's business-hours window in the SALON timezone. `date` is an instant;
    // we take its salon-tz calendar day, then construct the open/close wall-clock times
    // in that zone so slots are correct regardless of where the server or staff are.
    const dayInTz = new TZDate(date, tz);
    const y = dayInTz.getFullYear();
    const mo = dayInTz.getMonth();
    const dd = dayInTz.getDate();
    const dayStart = new TZDate(y, mo, dd, startHour, startMin, 0, 0, tz);
    const dayEnd = new TZDate(y, mo, dd, endHour, endMin, 0, 0, tz);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    // Existing appointments that day involving any of our providers, with their service segments.
    // Overlap the day window on the overall span, then compare per-service segments in memory.
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        salonId: authResult.salonId,
        services: { some: { staffId: { in: allStaffIds } } },
        startTime: { lt: new Date(dayEndMs) },
        endTime: { gt: new Date(dayStartMs) },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
      },
      select: {
        startTime: true,
        services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
      },
    });
    // Precompute each existing appointment's provider segments once.
    const existingSegments = existingAppointments.flatMap((apt) =>
      computeSegments(apt.startTime.getTime(), apt.services)
    );

    // Calculate available slots
    const slots: { startTime: Date; endTime: Date }[] = [];
    let currentTime = new TZDate(dayStartMs, tz);

    // Generate slots at the configured interval
    while (currentTime.getTime() < dayEndMs) {
      const slotStartMs = currentTime.getTime();
      const slotEndMs = slotStartMs + totalDuration * 60_000;

      // Check if slot fits within business hours
      if (slotEndMs <= dayEndMs) {
        // A slot is free only if EVERY provider is free during the exact slice they'd work.
        const slotSegs = computeSegments(slotStartMs, lines);
        const conflict = slotSegs.some((a) =>
          existingSegments.some(
            (b) => a.staffId === b.staffId && a.startMs < b.endMs && a.endMs > b.startMs
          )
        );
        if (!conflict) {
          slots.push({ startTime: new Date(slotStartMs), endTime: new Date(slotEndMs) });
        }
      }

      // Move to the next slot boundary (configured interval)
      currentTime.setMinutes(currentTime.getMinutes() + slotInterval);
    }

    return { success: true, data: slots };
  } catch (error) {
    console.error("Error getting available slots:", error);
    return { success: false, error: "Failed to get available slots" };
  }
}

// Get staff members who can perform appointments
export async function getStaffForAppointments(): Promise<ActionResult<{
  id: string;
  firstName: string;
  lastName: string;
}[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Resolve staff via branch membership (UserSalon). User.salonId is volatile (it's the
    // user's last-used branch) so it can't be used to determine who works at this branch.
    // Restricts to service providers — function is "for appointments" so non-providers
    // should never be returned.
    const staffRows = await prisma.userSalon.findMany({
      where: {
        salonId: authResult.salonId,
        isActive: true,
        user: { isActive: true, isServiceProvider: true },
      },
      select: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      distinct: ["userId"],
      orderBy: { user: { firstName: "asc" } },
    });
    const staff = staffRows.map((row) => row.user);

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching staff:", error);
    return { success: false, error: "Failed to fetch staff" };
  }
}

// Get appointments for calendar view (optimized for date range)
export async function getAppointmentsForCalendar(params: {
  startDate: Date;
  endDate: Date;
  staffId?: string;
}): Promise<ActionResult<AppointmentListItem[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { startDate, endDate, staffId } = params;

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        salonId: authResult.salonId,
        startTime: { gte: startDate, lte: endDate },
        // Filter by any appointment where this staff member performs a service (primary or secondary).
    ...(staffId && { services: { some: { staffId } } }),
      },
      include: appointmentListInclude,
      orderBy: { startTime: "asc" },
    });

    return { success: true, data: appointments };
  } catch (error) {
    console.error("Error fetching appointments for calendar:", error);
    return { success: false, error: "Failed to fetch appointments" };
  }
}

// ============================================
// RECURRING APPOINTMENT SERIES
// ============================================
// NOTE: Recurring series functionality has been moved to lib/actions/recurring-series.ts
// Import directly from that file for:
// - createRecurringSeries, getRecurringSeries, getRecurringSeriesById
// - updateRecurringSeries, updateSeriesAppointments, cancelRecurringSeries
// - pauseSeries, resumeSeries, extendSeries, cloneSeries
// - addExceptionDate, removeExceptionDate, getExceptionDates
// - detachOccurrence, cancelFromDate, getAlternativeSlots
// - getPatternLabel, RecurringSeriesListItem (type)

// ============================================
// APPOINTMENT DEPOSITS / PREPAYMENTS
// ============================================

/**
 * Records a deposit/prepayment against an appointment (before checkout). Stored as
 * a Payment with appointmentId set and invoiceId null — a held prepayment that is
 * applied to the invoice when the appointment is later checked out.
 */
export async function addAppointmentDeposit(
  appointmentId: string,
  data: { amount: number; method: PaymentMethod }
): Promise<ActionResult<{ id: string; depositPaid: number }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = appointmentDepositSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const amount = Math.round(parsed.data.amount * 100) / 100;
  const method = parsed.data.method;

  try {
    // Re-read state, bound the deposit to the outstanding balance, and insert atomically so a
    // concurrent checkout/deposit can't push the appointment past its total.
    const outcome = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, salonId: authResult.salonId },
        select: {
          id: true,
          status: true,
          sale: { select: { id: true } },
          services: { select: { price: true } },
          payments: { select: { amount: true } },
        },
      });
      if (!appointment) {
        return { ok: false as const, error: "Appointment not found" };
      }
      if (appointment.sale) {
        return { ok: false as const, error: "This appointment has already been checked out." };
      }
      if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
        return { ok: false as const, error: "Can't take a deposit on a cancelled or no-show appointment." };
      }

      const serviceTotal = appointment.services.reduce((sum, s) => sum + Number(s.price), 0);
      const alreadyPaid = appointment.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const outstanding = Math.round((serviceTotal - alreadyPaid) * 100) / 100;
      if (outstanding <= 0) {
        return { ok: false as const, error: "This appointment is already fully prepaid." };
      }
      if (amount > outstanding) {
        return { ok: false as const, error: `Deposit can't exceed the balance due of ${outstanding.toFixed(2)}.` };
      }

      assertPaymentOwner({ appointmentId });
      const payment = await tx.payment.create({
        data: { appointmentId, amount, method },
        select: { id: true },
      });
      return { ok: true as const, paymentId: payment.id, depositPaid: alreadyPaid + amount };
    });

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    await logAudit({
      action: "APPOINTMENT_DEPOSIT_ADDED",
      entityType: "Appointment",
      entityId: appointmentId,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { amount, method },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: { id: outcome.paymentId, depositPaid: outcome.depositPaid } };
  } catch (error) {
    console.error("Error adding appointment deposit:", error);
    return { success: false, error: "Failed to record deposit" };
  }
}
