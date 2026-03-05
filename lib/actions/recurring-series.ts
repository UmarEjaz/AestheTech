"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import {
  recurringAppointmentSchema,
  updateRecurringSeriesSchema,
  exceptionDateSchema,
  pauseSeriesSchema,
  extendSeriesSchema,
  cloneSeriesSchema,
  cancelFromDateSchema,
  RecurringAppointmentFormData,
  UpdateRecurringSeriesFormData,
  ExceptionDateFormData,
  PauseSeriesFormData,
  ExtendSeriesFormData,
  CloneSeriesFormData,
  CancelFromDateFormData,
} from "@/lib/validations/appointment";
import { Role, Prisma, RecurrencePattern, RecurrenceEndType } from "@prisma/client";
import { format, startOfDay, isBefore, addMonths } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
import { getTimezone } from "@/lib/actions/settings";
import {
  calculateRecurringDates,
  RecurringDateConfig,
} from "@/lib/utils/recurring";
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

// Include relations for recurring series
const recurringSeriesInclude = Prisma.validator<Prisma.RecurringAppointmentSeriesInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  service: {
    select: {
      id: true,
      name: true,
      duration: true,
      price: true,
    },
  },
  staff: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  appointments: {
    select: {
      id: true,
      startTime: true,
      status: true,
      isDetachedFromSeries: true,
    },
    orderBy: { startTime: "asc" },
  },
  exceptions: {
    select: {
      id: true,
      date: true,
      reason: true,
    },
    orderBy: { date: "asc" },
  },
});

export type RecurringSeriesListItem = Prisma.RecurringAppointmentSeriesGetPayload<{
  include: typeof recurringSeriesInclude;
}>;

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
        { startTime: { lte: startTime }, endTime: { gt: startTime } },
        { startTime: { lt: endTime }, endTime: { gte: endTime } },
        { startTime: { gte: startTime }, endTime: { lte: endTime } },
      ],
    },
  });

  return !!conflict;
}

// Log audit action
async function logAuditAction(
  seriesId: string,
  action: string,
  performedBy: string,
  changes?: Record<string, unknown>
) {
  await prisma.recurringSeriesAuditLog.create({
    data: {
      seriesId,
      action,
      performedBy,
      changes: changes ? (changes as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

// ============================================
// SERIES CRUD OPERATIONS
// ============================================

/**
 * Create a recurring appointment series with all pattern support
 */
export async function createRecurringSeries(
  data: RecurringAppointmentFormData
): Promise<ActionResult<{
  series: RecurringSeriesListItem;
  createdCount: number;
  skippedDates: { date: string; reason: string }[];
}>> {
  const authResult = await checkAuth("appointments:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = recurringAppointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const validData = validationResult.data;
  const tz = await getTimezone();

  try {
    // Verify client, service, and staff exist and are active
    const [client, service, staff] = await Promise.all([
      prisma.client.findUnique({ where: { id: validData.clientId }, select: { isActive: true } }),
      prisma.service.findUnique({ where: { id: validData.serviceId }, select: { duration: true, price: true, isActive: true } }),
      prisma.user.findUnique({ where: { id: validData.staffId }, select: { isActive: true } }),
    ]);

    if (!client?.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }
    if (!service?.isActive) {
      return { success: false, error: "Service not found or inactive" };
    }
    if (!staff?.isActive) {
      return { success: false, error: "Staff member not found or inactive" };
    }

    // Create the series
    const series = await prisma.recurringAppointmentSeries.create({
      data: {
        clientId: validData.clientId,
        serviceId: validData.serviceId,
        staffId: validData.staffId,
        pattern: validData.pattern,
        customWeeks: validData.pattern === "CUSTOM" ? validData.customWeeks : null,
        dayOfWeek: validData.dayOfWeek ?? 0,
        timeOfDay: validData.timeOfDay,
        specificDays: validData.pattern === "SPECIFIC_DAYS" ? validData.specificDays : [],
        nthWeek: validData.pattern === "NTH_WEEKDAY" ? validData.nthWeek : null,
        endType: validData.endType,
        endAfterCount: validData.endType === "AFTER_COUNT" ? validData.endAfterCount : null,
        endByDate: validData.endType === "BY_DATE" ? validData.endByDate : null,
        lockedPrice: validData.lockedPrice ? new Prisma.Decimal(validData.lockedPrice) : null,
        bufferMinutes: validData.bufferMinutes ?? 0,
        notes: validData.notes || null,
      },
    });

    // Calculate dates based on pattern (use user-provided startDate or default to now)
    const dateConfig: RecurringDateConfig = {
      pattern: validData.pattern,
      startDate: validData.startDate ?? new Date(),
      timeOfDay: validData.timeOfDay,
      dayOfWeek: validData.dayOfWeek ?? 0,
      customWeeks: validData.customWeeks,
      specificDays: validData.specificDays,
      nthWeek: validData.nthWeek,
      endType: validData.endType,
      endAfterCount: validData.endAfterCount,
      endByDate: validData.endByDate,
      exceptionDates: [],
    };

    const dates = calculateRecurringDates(dateConfig);

    // Create appointments for each date
    const skippedDates: { date: string; reason: string }[] = [];
    let createdCount = 0;
    const serviceDuration = service.duration + (validData.bufferMinutes ?? 0);

    // Build lookup maps for user conflict resolution choices
    const userSkipDates = new Set(
      (validData.skipDates ?? []).map(d => startOfDay(new Date(d)).getTime())
    );
    const alternativesByDate = new Map(
      (validData.selectedAlternatives ?? []).map(alt => [
        startOfDay(new Date(alt.originalDate)).getTime(),
        alt.alternative,
      ])
    );

    for (const date of dates) {
      const dateKey = startOfDay(date).getTime();

      // Check if user explicitly chose to skip this date
      if (userSkipDates.has(dateKey)) {
        skippedDates.push({
          date: formatInTz(date, "MMM d, yyyy", tz),
          reason: "Skipped by user",
        });
        continue;
      }

      // Check if user selected an alternative for this date
      const alternative = alternativesByDate.get(dateKey);
      if (alternative) {
        // Use the alternative time/staff
        const altStartTime = new Date(alternative.startTime);
        const altEndTime = new Date(alternative.endTime);
        const altStaffId = alternative.staffId;

        // Verify alternative slot is still available
        const altHasConflict = await checkConflict(altStaffId, altStartTime, altEndTime);
        if (altHasConflict) {
          skippedDates.push({
            date: formatInTz(date, "MMM d, yyyy", tz),
            reason: "Alternative slot no longer available",
          });
          continue;
        }

        await prisma.appointment.create({
          data: {
            clientId: validData.clientId,
            serviceId: validData.serviceId,
            staffId: altStaffId,
            startTime: altStartTime,
            endTime: altEndTime,
            notes: validData.notes || null,
            status: "SCHEDULED",
            seriesId: series.id,
          },
        });
        createdCount++;
        continue;
      }

      // Normal flow - use original time
      const startTime = date;
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + serviceDuration);

      // Check for conflicts
      const hasConflict = await checkConflict(validData.staffId, startTime, endTime);

      if (hasConflict) {
        skippedDates.push({
          date: formatInTz(date, "MMM d, yyyy", tz),
          reason: "Time slot conflict",
        });
        continue;
      }

      await prisma.appointment.create({
        data: {
          clientId: validData.clientId,
          serviceId: validData.serviceId,
          staffId: validData.staffId,
          startTime,
          endTime,
          notes: validData.notes || null,
          status: "SCHEDULED",
          seriesId: series.id,
        },
      });
      createdCount++;
    }

    // Update occurrences created count
    await prisma.recurringAppointmentSeries.update({
      where: { id: series.id },
      data: { occurrencesCreated: createdCount },
    });

    // Log audit
    await logAuditAction(series.id, "CREATED", authResult.userId, {
      pattern: validData.pattern,
      endType: validData.endType,
      appointmentsCreated: createdCount,
      skippedCount: skippedDates.length,
    });

    // Refetch series with appointments
    const updatedSeries = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: series.id },
      include: recurringSeriesInclude,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return {
      success: true,
      data: {
        series: updatedSeries!,
        createdCount,
        skippedDates,
      },
    };
  } catch (error) {
    console.error("Error creating recurring series:", error);
    return { success: false, error: "Failed to create recurring series" };
  }
}

/**
 * Get recurring series (optionally filter by client)
 */
export async function getRecurringSeries(params?: {
  clientId?: string;
  activeOnly?: boolean;
  includePaused?: boolean;
}): Promise<ActionResult<RecurringSeriesListItem[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { clientId, activeOnly = true, includePaused = true } = params || {};

  try {
    const series = await prisma.recurringAppointmentSeries.findMany({
      where: {
        ...(clientId && { clientId }),
        ...(activeOnly && { isActive: true }),
        ...(!includePaused && { isPaused: false }),
      },
      include: recurringSeriesInclude,
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: series };
  } catch (error) {
    console.error("Error fetching recurring series:", error);
    return { success: false, error: "Failed to fetch recurring series" };
  }
}

/**
 * Get single recurring series by ID
 */
export async function getRecurringSeriesById(id: string): Promise<ActionResult<RecurringSeriesListItem>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id },
      include: recurringSeriesInclude,
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    return { success: true, data: series };
  } catch (error) {
    console.error("Error fetching recurring series:", error);
    return { success: false, error: "Failed to fetch recurring series" };
  }
}

/**
 * Update series configuration (not individual appointments)
 */
export async function updateRecurringSeries(
  seriesId: string,
  data: UpdateRecurringSeriesFormData
): Promise<ActionResult<RecurringSeriesListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = updateRecurringSeriesSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "Cannot update cancelled series" };
    }

    const { staffId, timeOfDay, notes, bufferMinutes } = validationResult.data;

    const updateData: Prisma.RecurringAppointmentSeriesUpdateInput = {};
    const changes: Record<string, unknown> = {};

    if (staffId && staffId !== series.staffId) {
      updateData.staff = { connect: { id: staffId } };
      changes.staffId = { from: series.staffId, to: staffId };
    }
    if (timeOfDay && timeOfDay !== series.timeOfDay) {
      updateData.timeOfDay = timeOfDay;
      changes.timeOfDay = { from: series.timeOfDay, to: timeOfDay };
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
      changes.notes = { from: series.notes, to: notes };
    }
    if (bufferMinutes !== undefined && bufferMinutes !== series.bufferMinutes) {
      updateData.bufferMinutes = bufferMinutes;
      changes.bufferMinutes = { from: series.bufferMinutes, to: bufferMinutes };
    }

    const updatedSeries = await prisma.recurringAppointmentSeries.update({
      where: { id: seriesId },
      data: updateData,
      include: recurringSeriesInclude,
    });

    if (Object.keys(changes).length > 0) {
      await logAuditAction(seriesId, "UPDATED", authResult.userId, changes);
    }

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: updatedSeries };
  } catch (error) {
    console.error("Error updating recurring series:", error);
    return { success: false, error: "Failed to update recurring series" };
  }
}

/**
 * Update all future appointments in a series
 */
export async function updateSeriesAppointments(
  seriesId: string,
  data: UpdateRecurringSeriesFormData
): Promise<ActionResult<{ updatedCount: number; skippedDueToConflict: string[] }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = updateRecurringSeriesSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { staffId, timeOfDay, notes, bufferMinutes } = validationResult.data;
  const tz = await getTimezone();

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
      include: {
        service: { select: { duration: true } },
        appointments: {
          where: {
            startTime: { gte: new Date() },
            status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
            isDetachedFromSeries: false,
          },
        },
      },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "This recurring series has been cancelled" };
    }

    // Update the series record first
    await updateRecurringSeries(seriesId, data);

    // Update future appointments (use new bufferMinutes if provided, otherwise use existing)
    let updatedCount = 0;
    const skippedDueToConflict: string[] = [];
    const serviceDuration = series.service.duration + (bufferMinutes ?? series.bufferMinutes);

    for (const appointment of series.appointments) {
      const appointmentUpdateData: Prisma.AppointmentUpdateInput = {};

      if (staffId) {
        appointmentUpdateData.staff = { connect: { id: staffId } };
      }

      if (timeOfDay) {
        const { hours, minutes } = parseTimeOfDay(timeOfDay);
        const currentStart = new Date(appointment.startTime);
        const newStartTime = new Date(currentStart);
        newStartTime.setHours(hours, minutes, 0, 0);
        const newEndTime = new Date(newStartTime);
        newEndTime.setMinutes(newEndTime.getMinutes() + serviceDuration);

        // Check for conflicts with new time
        const hasConflict = await checkConflict(
          staffId || series.staffId,
          newStartTime,
          newEndTime,
          appointment.id
        );

        if (!hasConflict) {
          appointmentUpdateData.startTime = newStartTime;
          appointmentUpdateData.endTime = newEndTime;
        } else {
          // Track skipped appointments so user knows which couldn't be rescheduled
          skippedDueToConflict.push(formatInTz(appointment.startTime, "MMM d, yyyy", tz));
        }
      }

      if (notes !== undefined) {
        appointmentUpdateData.notes = notes || null;
      }

      if (Object.keys(appointmentUpdateData).length > 0) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: appointmentUpdateData,
        });
        updatedCount++;
      }
    }

    await logAuditAction(seriesId, "APPOINTMENTS_UPDATED", authResult.userId, {
      updatedCount,
      changes: { staffId, timeOfDay, notes },
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: { updatedCount, skippedDueToConflict } };
  } catch (error) {
    console.error("Error updating series appointments:", error);
    return { success: false, error: "Failed to update series appointments" };
  }
}

// Helper function
function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
}

/**
 * Cancel a recurring series and all future appointments
 */
export async function cancelRecurringSeries(seriesId: string): Promise<ActionResult<{ cancelledCount: number }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "This recurring series is already cancelled" };
    }

    // Cancel all future appointments in the series
    const result = await prisma.appointment.updateMany({
      where: {
        seriesId,
        startTime: { gte: new Date() },
        status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
      },
      data: { status: "CANCELLED" },
    });

    // Mark the series as inactive
    await prisma.recurringAppointmentSeries.update({
      where: { id: seriesId },
      data: { isActive: false },
    });

    await logAuditAction(seriesId, "CANCELLED", authResult.userId, {
      cancelledAppointments: result.count,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: { cancelledCount: result.count } };
  } catch (error) {
    console.error("Error cancelling recurring series:", error);
    return { success: false, error: "Failed to cancel recurring series" };
  }
}

// ============================================
// PAUSE / RESUME
// ============================================

/**
 * Pause a recurring series
 */
export async function pauseSeries(
  data: PauseSeriesFormData
): Promise<ActionResult<RecurringSeriesListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = pauseSeriesSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { seriesId, pausedUntil } = validationResult.data;

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "Cannot pause a cancelled series" };
    }

    if (series.isPaused) {
      return { success: false, error: "Series is already paused" };
    }

    const updatedSeries = await prisma.recurringAppointmentSeries.update({
      where: { id: seriesId },
      data: {
        isPaused: true,
        pausedAt: new Date(),
        pausedUntil: pausedUntil || null,
      },
      include: recurringSeriesInclude,
    });

    await logAuditAction(seriesId, "PAUSED", authResult.userId, {
      pausedUntil: pausedUntil ? format(pausedUntil, "yyyy-MM-dd") : null,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: updatedSeries };
  } catch (error) {
    console.error("Error pausing series:", error);
    return { success: false, error: "Failed to pause series" };
  }
}

/**
 * Resume a paused recurring series
 */
export async function resumeSeries(seriesId: string): Promise<ActionResult<RecurringSeriesListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "Cannot resume a cancelled series" };
    }

    if (!series.isPaused) {
      return { success: false, error: "Series is not paused" };
    }

    const updatedSeries = await prisma.recurringAppointmentSeries.update({
      where: { id: seriesId },
      data: {
        isPaused: false,
        pausedAt: null,
        pausedUntil: null,
      },
      include: recurringSeriesInclude,
    });

    await logAuditAction(seriesId, "RESUMED", authResult.userId);

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: updatedSeries };
  } catch (error) {
    console.error("Error resuming series:", error);
    return { success: false, error: "Failed to resume series" };
  }
}

// ============================================
// EXTEND / CLONE
// ============================================

/**
 * Generate more appointments for a series
 */
export async function extendSeries(
  data: ExtendSeriesFormData
): Promise<ActionResult<{ createdCount: number; skippedDates: string[] }>> {
  const authResult = await checkAuth("appointments:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = extendSeriesSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { seriesId, additionalMonths } = validationResult.data;
  const tz = await getTimezone();

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
      include: {
        service: { select: { duration: true } },
        appointments: {
          select: { startTime: true },
          orderBy: { startTime: "desc" },
          take: 1,
        },
        exceptions: {
          select: { date: true },
        },
      },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "Cannot extend a cancelled series" };
    }

    if (series.isPaused) {
      return { success: false, error: "Cannot extend a paused series" };
    }

    // Check end conditions
    if (series.endType === "AFTER_COUNT" && series.endAfterCount) {
      if (series.occurrencesCreated >= series.endAfterCount) {
        return { success: false, error: "Series has reached its occurrence limit" };
      }
    }

    if (series.endType === "BY_DATE" && series.endByDate) {
      if (isBefore(series.endByDate, new Date())) {
        return { success: false, error: "Series has passed its end date" };
      }
    }

    // Find the last appointment date
    const lastAppointment = series.appointments[0];
    const startFrom = lastAppointment
      ? new Date(lastAppointment.startTime)
      : new Date();

    // Calculate dates (extend from last appointment, not from "now")
    const exceptionDates = series.exceptions.map((e) => new Date(e.date));
    const endDate = addMonths(startFrom, additionalMonths);

    const dateConfig: RecurringDateConfig = {
      pattern: series.pattern,
      startDate: startFrom,
      timeOfDay: series.timeOfDay,
      dayOfWeek: series.dayOfWeek,
      customWeeks: series.customWeeks,
      specificDays: series.specificDays,
      nthWeek: series.nthWeek,
      endType: series.endType === "NEVER" ? "BY_DATE" : series.endType,
      endAfterCount: series.endType === "AFTER_COUNT"
        ? (series.endAfterCount || 0) - series.occurrencesCreated
        : undefined,
      endByDate: series.endType === "BY_DATE" ? series.endByDate : endDate,
      exceptionDates,
    };

    const dates = calculateRecurringDates(dateConfig);

    const skippedDates: string[] = [];
    let createdCount = 0;
    const serviceDuration = series.service.duration + series.bufferMinutes;

    for (const date of dates) {
      // Skip if appointment already exists for this date
      const existingForDate = await prisma.appointment.findFirst({
        where: {
          seriesId,
          startTime: {
            gte: startOfDay(date),
            lt: new Date(startOfDay(date).getTime() + 24 * 60 * 60 * 1000),
          },
        },
      });

      if (existingForDate) continue;

      const startTime = date;
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + serviceDuration);

      // Check for conflicts
      const hasConflict = await checkConflict(series.staffId, startTime, endTime);

      if (hasConflict) {
        skippedDates.push(formatInTz(date, "MMM d, yyyy", tz));
        continue;
      }

      await prisma.appointment.create({
        data: {
          clientId: series.clientId,
          serviceId: series.serviceId,
          staffId: series.staffId,
          startTime,
          endTime,
          notes: series.notes,
          status: "SCHEDULED",
          seriesId: series.id,
        },
      });
      createdCount++;
    }

    // Update occurrences count
    await prisma.recurringAppointmentSeries.update({
      where: { id: seriesId },
      data: { occurrencesCreated: series.occurrencesCreated + createdCount },
    });

    await logAuditAction(seriesId, "EXTENDED", authResult.userId, {
      additionalMonths,
      appointmentsCreated: createdCount,
      skippedCount: skippedDates.length,
    });

    revalidatePath("/dashboard/appointments");

    return { success: true, data: { createdCount, skippedDates } };
  } catch (error) {
    console.error("Error extending series:", error);
    return { success: false, error: "Failed to extend series" };
  }
}

/**
 * Clone a series (copy to same or different client)
 */
export async function cloneSeries(
  data: CloneSeriesFormData
): Promise<ActionResult<RecurringSeriesListItem>> {
  const authResult = await checkAuth("appointments:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = cloneSeriesSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { seriesId, newClientId, newStaffId, newTimeOfDay } = validationResult.data;

  try {
    const originalSeries = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!originalSeries) {
      return { success: false, error: "Original series not found" };
    }

    // Create new series based on original
    const newSeriesData: RecurringAppointmentFormData = {
      clientId: newClientId || originalSeries.clientId,
      serviceId: originalSeries.serviceId,
      staffId: newStaffId || originalSeries.staffId,
      pattern: originalSeries.pattern,
      timeOfDay: newTimeOfDay || originalSeries.timeOfDay,
      dayOfWeek: originalSeries.dayOfWeek,
      customWeeks: originalSeries.customWeeks || undefined,
      specificDays: originalSeries.specificDays,
      nthWeek: originalSeries.nthWeek || undefined,
      endType: originalSeries.endType,
      endAfterCount: originalSeries.endAfterCount || undefined,
      endByDate: originalSeries.endByDate || undefined,
      lockedPrice: originalSeries.lockedPrice ? Number(originalSeries.lockedPrice) : undefined,
      bufferMinutes: originalSeries.bufferMinutes,
      notes: originalSeries.notes || undefined,
    };

    const result = await createRecurringSeries(newSeriesData);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    await logAuditAction(seriesId, "CLONED", authResult.userId, {
      newSeriesId: result.data.series.id,
      newClientId: newClientId || "same",
      newStaffId: newStaffId || "same",
    });

    return { success: true, data: result.data.series };
  } catch (error) {
    console.error("Error cloning series:", error);
    return { success: false, error: "Failed to clone series" };
  }
}

// ============================================
// EXCEPTION DATES
// ============================================

/**
 * Add an exception date to skip
 */
export async function addExceptionDate(
  data: ExceptionDateFormData
): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = exceptionDateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { seriesId, date, reason } = validationResult.data;

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    if (!series.isActive) {
      return { success: false, error: "Cannot add exception to cancelled series" };
    }

    // Check if exception already exists
    const existing = await prisma.recurringSeriesException.findUnique({
      where: {
        seriesId_date: {
          seriesId,
          date: startOfDay(date),
        },
      },
    });

    if (existing) {
      return { success: false, error: "Exception date already exists" };
    }

    const exception = await prisma.recurringSeriesException.create({
      data: {
        seriesId,
        date: startOfDay(date),
        reason: reason || null,
      },
    });

    // Cancel any existing appointment on this date
    await prisma.appointment.updateMany({
      where: {
        seriesId,
        startTime: {
          gte: startOfDay(date),
          lt: new Date(startOfDay(date).getTime() + 24 * 60 * 60 * 1000),
        },
        status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
      },
      data: { status: "CANCELLED" },
    });

    await logAuditAction(seriesId, "EXCEPTION_ADDED", authResult.userId, {
      date: format(date, "yyyy-MM-dd"),
      reason,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: { id: exception.id } };
  } catch (error) {
    console.error("Error adding exception date:", error);
    return { success: false, error: "Failed to add exception date" };
  }
}

/**
 * Remove an exception date
 */
export async function removeExceptionDate(exceptionId: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const exception = await prisma.recurringSeriesException.findUnique({
      where: { id: exceptionId },
      include: { series: true },
    });

    if (!exception) {
      return { success: false, error: "Exception not found" };
    }

    await prisma.recurringSeriesException.delete({
      where: { id: exceptionId },
    });

    await logAuditAction(exception.seriesId, "EXCEPTION_REMOVED", authResult.userId, {
      date: format(exception.date, "yyyy-MM-dd"),
      reason: exception.reason,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error removing exception date:", error);
    return { success: false, error: "Failed to remove exception date" };
  }
}

/**
 * Get exception dates for a series
 */
export async function getExceptionDates(seriesId: string): Promise<ActionResult<{
  id: string;
  date: Date;
  reason: string | null;
}[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const exceptions = await prisma.recurringSeriesException.findMany({
      where: { seriesId },
      orderBy: { date: "asc" },
    });

    return { success: true, data: exceptions };
  } catch (error) {
    console.error("Error fetching exception dates:", error);
    return { success: false, error: "Failed to fetch exception dates" };
  }
}

// ============================================
// OCCURRENCE MANAGEMENT
// ============================================

/**
 * Detach an appointment from its series (edit single occurrence)
 */
export async function detachOccurrence(appointmentId: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { series: true },
    });

    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }

    if (!appointment.seriesId) {
      return { success: false, error: "Appointment is not part of a series" };
    }

    if (appointment.isDetachedFromSeries) {
      return { success: false, error: "Appointment is already detached from series" };
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { isDetachedFromSeries: true },
    });

    await logAuditAction(appointment.seriesId, "OCCURRENCE_DETACHED", authResult.userId, {
      appointmentId,
      date: format(appointment.startTime, "yyyy-MM-dd"),
    });

    revalidatePath("/dashboard/appointments");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error detaching occurrence:", error);
    return { success: false, error: "Failed to detach occurrence" };
  }
}

/**
 * Cancel all appointments from a specific date forward
 */
export async function cancelFromDate(
  data: CancelFromDateFormData
): Promise<ActionResult<{ cancelledCount: number }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = cancelFromDateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { seriesId, fromDate } = validationResult.data;

  try {
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return { success: false, error: "Recurring series not found" };
    }

    const result = await prisma.appointment.updateMany({
      where: {
        seriesId,
        startTime: { gte: startOfDay(fromDate) },
        status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
      },
      data: { status: "CANCELLED" },
    });

    await logAuditAction(seriesId, "CANCELLED_FROM_DATE", authResult.userId, {
      fromDate: format(fromDate, "yyyy-MM-dd"),
      cancelledCount: result.count,
    });

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/clients");

    return { success: true, data: { cancelledCount: result.count } };
  } catch (error) {
    console.error("Error cancelling from date:", error);
    return { success: false, error: "Failed to cancel appointments" };
  }
}

// ============================================
// PREVIEW DATES (for form preview)
// ============================================

export interface PreviewDatesParams {
  pattern: RecurrencePattern;
  startDate: Date;
  timeOfDay: string;
  dayOfWeek: number;
  customWeeks?: number;
  specificDays?: number[];
  nthWeek?: number;
  endType: RecurrenceEndType;
  endAfterCount?: number;
  endByDate?: Date;
  maxPreviewCount?: number;
}

/**
 * Get preview dates for recurring appointments using the same logic as actual creation.
 * This ensures preview matches what will actually be created.
 */
export async function getRecurringPreviewDates(
  params: PreviewDatesParams
): Promise<ActionResult<{ dates: Date[] }>> {
  // No auth required for preview - it's just date calculation
  // The actual creation will have proper auth checks

  const {
    pattern,
    startDate,
    timeOfDay,
    dayOfWeek,
    customWeeks,
    specificDays,
    nthWeek,
    endType,
    endAfterCount,
    endByDate,
    maxPreviewCount = 6, // Show max 6 dates in preview
  } = params;

  try {
    const dateConfig: RecurringDateConfig = {
      pattern,
      startDate: new Date(startDate),
      timeOfDay,
      dayOfWeek,
      customWeeks,
      specificDays,
      nthWeek,
      endType,
      endAfterCount: endType === "AFTER_COUNT"
        ? Math.min(endAfterCount || 6, maxPreviewCount)
        : undefined,
      endByDate: endType === "BY_DATE" ? endByDate : undefined,
      exceptionDates: [],
      maxDates: maxPreviewCount,
    };

    const dates = calculateRecurringDates(dateConfig);

    return { success: true, data: { dates: dates.slice(0, maxPreviewCount) } };
  } catch (error) {
    console.error("Error calculating preview dates:", error);
    return { success: false, error: "Failed to calculate preview dates" };
  }
}

// ============================================
// CONFLICT RESOLUTION
// ============================================

export interface ConflictPreview {
  date: Date;
  reason: string;
  alternatives: {
    startTime: Date;
    endTime: Date;
    staffId: string;
    staffName: string;
  }[];
}

export interface RecurringPreviewResult {
  totalDates: number;
  availableDates: Date[];
  conflicts: ConflictPreview[];
}

/**
 * Preview recurring appointments and check for conflicts before creation
 */
export async function previewRecurringConflicts(
  data: RecurringAppointmentFormData
): Promise<ActionResult<RecurringPreviewResult>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = recurringAppointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const validData = validationResult.data;

  try {
    // Verify service exists and get duration
    const service = await prisma.service.findUnique({
      where: { id: validData.serviceId },
      select: { duration: true, isActive: true },
    });

    if (!service?.isActive) {
      return { success: false, error: "Service not found or inactive" };
    }

    // Get staff info for alternatives
    const staffMember = await prisma.user.findUnique({
      where: { id: validData.staffId },
      select: { firstName: true, lastName: true },
    });

    if (!staffMember) {
      return { success: false, error: "Staff member not found" };
    }

    // Get business hours
    const settings = await prisma.settings.findFirst();
    const businessStart = settings?.businessHoursStart || "09:00";
    const businessEnd = settings?.businessHoursEnd || "19:00";

    // Calculate dates based on pattern (use user-provided startDate or default to now)
    const dateConfig: RecurringDateConfig = {
      pattern: validData.pattern,
      startDate: validData.startDate ?? new Date(),
      timeOfDay: validData.timeOfDay,
      dayOfWeek: validData.dayOfWeek ?? 0,
      customWeeks: validData.customWeeks,
      specificDays: validData.specificDays,
      nthWeek: validData.nthWeek,
      endType: validData.endType,
      endAfterCount: validData.endAfterCount,
      endByDate: validData.endByDate,
      exceptionDates: [],
    };

    const dates = calculateRecurringDates(dateConfig);
    const serviceDuration = service.duration + (validData.bufferMinutes ?? 0);

    const availableDates: Date[] = [];
    const conflicts: ConflictPreview[] = [];

    for (const date of dates) {
      const startTime = date;
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + serviceDuration);

      // Check for conflicts
      const hasConflict = await checkConflict(validData.staffId, startTime, endTime);

      if (hasConflict) {
        // Find alternative slots for this date
        const alternatives = await findAlternativeSlotsForDate(
          validData.staffId,
          staffMember,
          date,
          serviceDuration,
          validData.timeOfDay,
          businessStart,
          businessEnd
        );

        conflicts.push({
          date,
          reason: "Time slot already booked",
          alternatives,
        });
      } else {
        availableDates.push(date);
      }
    }

    return {
      success: true,
      data: {
        totalDates: dates.length,
        availableDates,
        conflicts,
      },
    };
  } catch (error) {
    console.error("Error previewing conflicts:", error);
    return { success: false, error: "Failed to preview conflicts" };
  }
}

/**
 * Helper to find alternative slots for a specific date
 */
async function findAlternativeSlotsForDate(
  staffId: string,
  staffMember: { firstName: string; lastName: string },
  date: Date,
  serviceDuration: number,
  preferredTime: string,
  businessStart: string,
  businessEnd: string
): Promise<ConflictPreview["alternatives"]> {
  const [startHour, startMin = 0] = businessStart.split(":").map(Number);
  const [endHour, endMin = 0] = businessEnd.split(":").map(Number);
  const businessStartMinutes = startHour * 60 + startMin;
  const businessEndMinutes = endHour * 60 + endMin;
  const [preferredHour, preferredMin] = preferredTime.split(":").map(Number);

  // Get existing appointments for the day
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      staffId,
      startTime: { gte: dayStart, lt: dayEnd },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    orderBy: { startTime: "asc" },
    select: { startTime: true, endTime: true },
  });

  const alternatives: ConflictPreview["alternatives"] = [];

  // Check slots around the preferred time (±2 hours)
  const checkTimes = [
    preferredHour * 60 + preferredMin + 30,
    preferredHour * 60 + preferredMin - 30,
    preferredHour * 60 + preferredMin + 60,
    preferredHour * 60 + preferredMin - 60,
    preferredHour * 60 + preferredMin + 90,
    preferredHour * 60 + preferredMin - 90,
    preferredHour * 60 + preferredMin + 120,
    preferredHour * 60 + preferredMin - 120,
  ].filter((t) => t >= businessStartMinutes && t + serviceDuration <= businessEndMinutes && t > 0);

  for (const timeInMinutes of checkTimes) {
    if (alternatives.length >= 4) break;

    const hour = Math.floor(timeInMinutes / 60);
    const minute = timeInMinutes % 60;

    const slotStart = new Date(date);
    slotStart.setHours(hour, minute, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + serviceDuration);

    // Check for conflicts
    const hasConflict = existingAppointments.some((apt) => {
      const aptStart = new Date(apt.startTime);
      const aptEnd = new Date(apt.endTime);
      return (
        (slotStart >= aptStart && slotStart < aptEnd) ||
        (slotEnd > aptStart && slotEnd <= aptEnd) ||
        (slotStart <= aptStart && slotEnd >= aptEnd)
      );
    });

    if (!hasConflict && !alternatives.some((a) => a.startTime.getTime() === slotStart.getTime())) {
      alternatives.push({
        startTime: slotStart,
        endTime: slotEnd,
        staffId,
        staffName: `${staffMember.firstName} ${staffMember.lastName}`,
      });
    }
  }

  return alternatives;
}

/**
 * Get alternative time slots when there's a conflict
 */
export async function getAlternativeSlots(params: {
  staffId: string;
  date: Date;
  serviceId: string;
  preferredTime: string;
}): Promise<ActionResult<{ startTime: Date; endTime: Date }[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { staffId, date, serviceId, preferredTime } = params;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration: true },
    });

    if (!service) {
      return { success: false, error: "Service not found" };
    }

    // Get business hours from settings
    const settings = await prisma.settings.findFirst();
    const businessStart = settings?.businessHoursStart || "09:00";
    const businessEnd = settings?.businessHoursEnd || "19:00";

    const [startHour, startMin = 0] = businessStart.split(":").map(Number);
    const [endHour, endMin = 0] = businessEnd.split(":").map(Number);
    const businessStartMinutes = startHour * 60 + startMin;
    const businessEndMinutes = endHour * 60 + endMin;
    const [preferredHour, preferredMin] = preferredTime.split(":").map(Number);

    // Get existing appointments for the day
    const dayStart = startOfDay(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffId,
        startTime: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startTime: "asc" },
      select: { startTime: true, endTime: true },
    });

    // Find available slots
    const slots: { startTime: Date; endTime: Date }[] = [];
    const slotDuration = service.duration;

    // Check slots around the preferred time first (±2 hours)
    const checkTimes = [
      preferredHour * 60 + preferredMin,
      preferredHour * 60 + preferredMin + 30,
      preferredHour * 60 + preferredMin - 30,
      preferredHour * 60 + preferredMin + 60,
      preferredHour * 60 + preferredMin - 60,
      preferredHour * 60 + preferredMin + 90,
      preferredHour * 60 + preferredMin - 90,
      preferredHour * 60 + preferredMin + 120,
      preferredHour * 60 + preferredMin - 120,
    ].filter((t) => t >= businessStartMinutes && t + slotDuration <= businessEndMinutes);

    for (const timeInMinutes of checkTimes) {
      if (slots.length >= 5) break;

      const hour = Math.floor(timeInMinutes / 60);
      const minute = timeInMinutes % 60;

      const slotStart = new Date(date);
      slotStart.setHours(hour, minute, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

      // Check for conflicts
      const hasConflict = existingAppointments.some((apt) => {
        const aptStart = new Date(apt.startTime);
        const aptEnd = new Date(apt.endTime);
        return (
          (slotStart >= aptStart && slotStart < aptEnd) ||
          (slotEnd > aptStart && slotEnd <= aptEnd) ||
          (slotStart <= aptStart && slotEnd >= aptEnd)
        );
      });

      if (!hasConflict && !slots.some((s) => s.startTime.getTime() === slotStart.getTime())) {
        slots.push({ startTime: slotStart, endTime: slotEnd });
      }
    }

    return { success: true, data: slots };
  } catch (error) {
    console.error("Error getting alternative slots:", error);
    return { success: false, error: "Failed to get alternative slots" };
  }
}

