"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import {
  appointmentSchema,
  appointmentStatusSchema,
  rescheduleSchema,
  AppointmentFormData,
  AppointmentStatusFormData,
  RescheduleFormData,
} from "@/lib/validations/appointment";
import { Role, Prisma, AppointmentStatus } from "@prisma/client";
import { getSettings } from "./settings";
import { ActionResult } from "@/lib/types";

async function checkAuth(permission: Permission): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission)) {
    return null;
  }

  return { userId: session.user.id, role };
}

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
  service: {
    select: {
      id: true,
      name: true,
      duration: true,
      price: true,
      category: true,
    },
  },
  staff: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
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
  const skip = (page - 1) * limit;

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
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ]);

    return {
      success: true,
      data: {
        appointments,
        total,
        page,
        totalPages: Math.ceil(total / limit),
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
    const appointment = await prisma.appointment.findUnique({
      where: { id },
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
  excludeId?: string
): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      staffId,
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

  const { clientId, serviceId, staffId, startTime, notes } = validationResult.data;

  try {
    // Get service to calculate end time
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration: true, isActive: true },
    });

    if (!service) {
      return { success: false, error: "Service not found" };
    }

    if (!service.isActive) {
      return { success: false, error: "Service is not available" };
    }

    // Calculate end time
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + service.duration);

    // Check for conflicts
    const hasConflict = await checkConflict(staffId, startTime, endTime);
    if (hasConflict) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    // Verify client exists and is active
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Verify staff exists and is active
    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { isActive: true },
    });

    if (!staff || !staff.isActive) {
      return { success: false, error: "Staff member not found or inactive" };
    }

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        serviceId,
        staffId,
        startTime,
        endTime,
        notes: notes || null,
        status: "SCHEDULED",
      },
      include: appointmentListInclude,
    });

    revalidatePath("/dashboard/appointments");
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

  const { clientId, serviceId, staffId, startTime, notes } = validationResult.data;

  try {
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot update completed or cancelled appointments" };
    }

    // Get service to calculate end time
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration: true },
    });

    if (!service) {
      return { success: false, error: "Service not found" };
    }

    // Calculate end time
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + service.duration);

    // Check for conflicts (excluding this appointment)
    const hasConflict = await checkConflict(staffId, startTime, endTime, id);
    if (hasConflict) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        clientId,
        serviceId,
        staffId,
        startTime,
        endTime,
        notes: notes || null,
      },
      include: appointmentListInclude,
    });

    revalidatePath("/dashboard/appointments");
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
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentStatusSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  try {
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    // Validate status transitions
    const validTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
      SCHEDULED: ["CONFIRMED", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: [],
      NO_SHOW: [],
    };

    const allowedNextStatuses = validTransitions[existing.status];
    if (!allowedNextStatuses.includes(validationResult.data.status)) {
      return {
        success: false,
        error: `Cannot change status from ${existing.status} to ${validationResult.data.status}`,
      };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status: validationResult.data.status },
      include: appointmentListInclude,
    });

    revalidatePath("/dashboard/appointments");
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
    const existing = await prisma.appointment.findUnique({
      where: { id },
      include: { service: { select: { duration: true } } },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot reschedule completed or cancelled appointments" };
    }

    const staffId = newStaffId || existing.staffId;

    // Calculate end time
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + existing.service.duration);

    // Check for conflicts
    const hasConflict = await checkConflict(staffId, startTime, endTime, id);
    if (hasConflict) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        startTime,
        endTime,
        staffId,
      },
      include: appointmentListInclude,
    });

    revalidatePath("/dashboard/appointments");
    return { success: true, data: appointment };
  } catch (error) {
    console.error("Error rescheduling appointment:", error);
    return { success: false, error: "Failed to reschedule appointment" };
  }
}

// Cancel appointment
export async function cancelAppointment(id: string): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existing = await prisma.appointment.findUnique({
      where: { id },
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

    revalidatePath("/dashboard/appointments");
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
    await prisma.appointment.delete({ where: { id } });

    revalidatePath("/dashboard/appointments");
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
  serviceId: string;
  excludeAppointmentId?: string; // Exclude this appointment from conflict check (for edit mode)
}): Promise<ActionResult<{ startTime: Date; endTime: Date }[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { staffId, date, serviceId, excludeAppointmentId } = params;

  try {
    // Get service duration
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration: true },
    });

    if (!service) {
      return { success: false, error: "Service not found" };
    }

    // Get business hours from settings
    const settingsResult = await getSettings();
    const settings = settingsResult.success
      ? settingsResult.data
      : { businessHoursStart: "09:00", businessHoursEnd: "19:00" };

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

    const dayStart = new Date(date);
    dayStart.setHours(startHour, startMin, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, endMin, 0, 0);

    // Get existing appointments for the staff on that day
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffId,
        startTime: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
      },
      orderBy: { startTime: "asc" },
      select: { startTime: true, endTime: true },
    });

    // Calculate available slots
    const slots: { startTime: Date; endTime: Date }[] = [];
    let currentTime = new Date(dayStart);

    // Generate slots in 30-minute increments
    while (currentTime < dayEnd) {
      const slotEnd = new Date(currentTime);
      slotEnd.setMinutes(slotEnd.getMinutes() + service.duration);

      // Check if slot fits within business hours
      if (slotEnd <= dayEnd) {
        // Check if slot conflicts with any existing appointment
        const hasConflict = existingAppointments.some((apt) => {
          const aptStart = new Date(apt.startTime);
          const aptEnd = new Date(apt.endTime);
          return (
            (currentTime >= aptStart && currentTime < aptEnd) ||
            (slotEnd > aptStart && slotEnd <= aptEnd) ||
            (currentTime <= aptStart && slotEnd >= aptEnd)
          );
        });

        if (!hasConflict) {
          slots.push({
            startTime: new Date(currentTime),
            endTime: new Date(slotEnd),
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
    const staff = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ["STAFF", "ADMIN", "OWNER"] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      orderBy: { firstName: "asc" },
    });

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
