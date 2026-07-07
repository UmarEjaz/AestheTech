"use server";

import { revalidatePath } from "next/cache";
import { TZDate } from "@date-fns/tz";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import {
  appointmentSchema,
  appointmentStatusSchema,
  rescheduleSchema,
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
    },
  },
  // Primary provider (denormalized = first service's staff), used for calendar lanes/filters.
  staff: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  // All services (1..N), each with its own staff + price/duration snapshot. order 0 = primary.
  services: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      price: true,
      duration: true,
      service: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
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
    ...(staffId && { staffId }),
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

// Check for appointment conflicts
async function checkConflict(
  staffId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string,
  salonId?: string
): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      staffId,
      ...(salonId && { salonId }),
      id: excludeId ? { not: excludeId } : undefined,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      OR: [
        // New appointment starts during existing
        { startTime: { lte: startTime }, endTime: { gt: startTime } },
        // New appointment ends during existing
        { startTime: { lt: endTime }, endTime: { gte: endTime } },
        // New appointment encompasses existing
        { startTime: { gte: startTime }, endTime: { lte: endTime } },
      ],
    },
  });

  return !!conflict;
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

    // Every distinct staff member involved must be free for the whole block
    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));
    for (const sid of distinctStaffIds) {
      const hasConflict = await checkConflict(sid, startTime, endTime, undefined, authResult.salonId);
      if (hasConflict) {
        return { success: false, error: "This time slot conflicts with another appointment" };
      }
    }

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
        staffId: primaryStaffId,
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

    // Every distinct staff member must be free for the whole block (excluding this appointment)
    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));
    for (const sid of distinctStaffIds) {
      const hasConflict = await checkConflict(sid, startTime, endTime, id, authResult.salonId);
      if (hasConflict) {
        return { success: false, error: "This time slot conflicts with another appointment" };
      }
    }

    const staffCheck = await verifyStaffProviders(distinctStaffIds, authResult.salonId);
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        clientId,
        staffId: primaryStaffId,
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
      select: { status: true, staffId: true, startTime: true, endTime: true },
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
      const hasConflict = await checkConflict(
        existing.staffId,
        existing.startTime,
        existing.endTime,
        id,
        authResult.salonId
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
      include: { services: { select: { id: true, duration: true, order: true } } },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot reschedule completed or cancelled appointments" };
    }

    const staffId = newStaffId || existing.staffId;

    // End time spans the total duration of all services
    const totalDuration = existing.services.reduce((sum, s) => sum + s.duration, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Check for conflicts
    const hasConflict = await checkConflict(staffId, startTime, endTime, id, authResult.salonId);
    if (hasConflict) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    // If the primary provider changed (dragged to a different staff lane), move the primary
    // service line to that staff too so appointment.staffId stays == the first service's staff.
    const primaryLine = existing.services.slice().sort((a, b) => a.order - b.order)[0];
    const movePrimary = primaryLine && staffId !== existing.staffId;

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        startTime,
        endTime,
        staffId,
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
      select: { id: true, clientId: true, staffId: true, startTime: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    await prisma.appointment.delete({
      where: { id },
    });

    await logAudit({
      action: "APPOINTMENT_DELETED",
      entityType: "Appointment",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId: existing.clientId, staffId: existing.staffId, startTime: existing.startTime },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting appointment:", error);
    return { success: false, error: "Failed to delete appointment" };
  }
}

// Get available time slots for a staff member on a given date
export async function getAvailableSlots(params: {
  staffId: string;
  date: Date;
  serviceIds: string[]; // all services on the appointment — slot length = sum of their durations
  excludeAppointmentId?: string; // Exclude this appointment from conflict check (for edit mode)
}): Promise<ActionResult<{ startTime: Date; endTime: Date }[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { staffId, date, serviceIds, excludeAppointmentId } = params;

  try {
    // Total duration across all services drives the slot length (org-scoped)
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
    if (!serviceIds || serviceIds.length === 0) {
      return { success: false, error: "Service not found" };
    }
    const serviceRows = await prisma.service.findMany({
      where: { id: { in: serviceIds }, salonId: { in: orgSalonIds } },
      select: { id: true, duration: true },
    });
    const durationById = new Map(serviceRows.map((s) => [s.id, s.duration]));
    let totalDuration = 0;
    for (const sid of serviceIds) {
      const d = durationById.get(sid);
      if (d === undefined) {
        return { success: false, error: "Service not found" };
      }
      totalDuration += d;
    }

    // Get business hours from settings
    const settingsResult = await getSettings();
    const settings = settingsResult.success
      ? settingsResult.data
      : { businessHoursStart: "09:00", businessHoursEnd: "19:00", timezone: "UTC" };
    const tz = settings.timezone || "UTC";

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

    // Get existing appointments for the staff on that day
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        salonId: authResult.salonId,
        staffId,
        startTime: { gte: new Date(dayStartMs), lt: new Date(dayEndMs) },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
      },
      orderBy: { startTime: "asc" },
      select: { startTime: true, endTime: true },
    });

    // Calculate available slots
    const slots: { startTime: Date; endTime: Date }[] = [];
    let currentTime = new TZDate(dayStartMs, tz);

    // Generate slots in 30-minute increments
    while (currentTime.getTime() < dayEndMs) {
      const slotStartMs = currentTime.getTime();
      const slotEnd = new TZDate(slotStartMs, tz);
      slotEnd.setMinutes(slotEnd.getMinutes() + totalDuration);
      const slotEndMs = slotEnd.getTime();

      // Check if slot fits within business hours
      if (slotEndMs <= dayEndMs) {
        // Check if slot conflicts with any existing appointment
        const hasConflict = existingAppointments.some((apt) => {
          const aptStart = new Date(apt.startTime).getTime();
          const aptEnd = new Date(apt.endTime).getTime();
          return (
            (slotStartMs >= aptStart && slotStartMs < aptEnd) ||
            (slotEndMs > aptStart && slotEndMs <= aptEnd) ||
            (slotStartMs <= aptStart && slotEndMs >= aptEnd)
          );
        });

        if (!hasConflict) {
          slots.push({
            startTime: new Date(slotStartMs),
            endTime: new Date(slotEndMs),
          });
        }
      }

      // Move to next 30-minute slot
      currentTime.setMinutes(currentTime.getMinutes() + 30);
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
        ...(staffId && { staffId }),
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

  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Enter a valid deposit amount" };
  }
  if (!Object.values(PaymentMethod).includes(data.method)) {
    return { success: false, error: "Invalid payment method" };
  }

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, salonId: authResult.salonId },
      select: {
        id: true,
        status: true,
        sale: { select: { id: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }
    if (appointment.sale) {
      return { success: false, error: "This appointment has already been checked out." };
    }
    if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
      return { success: false, error: "Can't take a deposit on a cancelled or no-show appointment." };
    }

    const payment = await prisma.payment.create({
      data: { appointmentId, amount, method: data.method },
      select: { id: true },
    });

    const depositPaid =
      appointment.payments.reduce((sum, p) => sum + Number(p.amount), 0) + amount;

    await logAudit({
      action: "APPOINTMENT_DEPOSIT_ADDED",
      entityType: "Appointment",
      entityId: appointmentId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { amount, method: data.method },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: { id: payment.id, depositPaid } };
  } catch (error) {
    console.error("Error adding appointment deposit:", error);
    return { success: false, error: "Failed to record deposit" };
  }
}
