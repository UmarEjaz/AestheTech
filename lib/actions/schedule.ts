"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import {
  scheduleSchema,
  weekScheduleSchema,
  ScheduleFormData,
  WeekScheduleFormData,
} from "@/lib/validations/schedule";
import { Role, Prisma, ShiftType } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

async function checkAuth(permission: Permission): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission)) {
    return null;
  }

  return { userId: session.user.id, role };
}

// Include relations for schedule list
const scheduleListInclude = Prisma.validator<Prisma.ScheduleInclude>()({
  staff: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
    },
  },
});

export type ScheduleListItem = Prisma.ScheduleGetPayload<{
  include: typeof scheduleListInclude;
}>;

// Day names for internal use
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Get all schedules (optionally filtered by staff)
export async function getSchedules(params: {
  staffId?: string;
  dayOfWeek?: number;
} = {}): Promise<ActionResult<ScheduleListItem[]>> {
  const authResult = await checkAuth("schedules:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { staffId, dayOfWeek } = params;

  const where: Prisma.ScheduleWhereInput = {
    ...(staffId && { staffId }),
    ...(dayOfWeek !== undefined && { dayOfWeek }),
  };

  try {
    const schedules = await prisma.schedule.findMany({
      where,
      include: scheduleListInclude,
      orderBy: [{ staffId: "asc" }, { dayOfWeek: "asc" }],
    });

    return { success: true, data: schedules };
  } catch (error) {
    console.error("Error fetching schedules:", error);
    return { success: false, error: "Failed to fetch schedules" };
  }
}

// Get schedule for a specific staff member
export async function getStaffSchedule(staffId: string): Promise<ActionResult<ScheduleListItem[]>> {
  const authResult = await checkAuth("schedules:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: { staffId },
      include: scheduleListInclude,
      orderBy: { dayOfWeek: "asc" },
    });

    return { success: true, data: schedules };
  } catch (error) {
    console.error("Error fetching staff schedule:", error);
    return { success: false, error: "Failed to fetch staff schedule" };
  }
}

// Get single schedule entry
export async function getSchedule(id: string): Promise<ActionResult<ScheduleListItem>> {
  const authResult = await checkAuth("schedules:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const schedule = await prisma.schedule.findUnique({
      where: { id },
      include: scheduleListInclude,
    });

    if (!schedule) {
      return { success: false, error: "Schedule not found" };
    }

    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error fetching schedule:", error);
    return { success: false, error: "Failed to fetch schedule" };
  }
}

// Check for schedule time overlap — accepts a Prisma transaction client for atomic operations
async function checkScheduleConflictTx(
  tx: Prisma.TransactionClient,
  staffId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<{ hasConflict: boolean; conflictWith?: string }> {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  const existing = await tx.schedule.findMany({
    where: {
      staffId,
      dayOfWeek,
      ...(excludeId && { id: { not: excludeId } }),
    },
  });

  for (const schedule of existing) {
    const existStart = timeToMinutes(schedule.startTime);
    const existEnd = timeToMinutes(schedule.endTime);

    // Check overlap: two ranges overlap if start < otherEnd AND end > otherStart
    if (startMinutes < existEnd && endMinutes > existStart) {
      return {
        hasConflict: true,
        conflictWith: `${schedule.startTime} - ${schedule.endTime} on ${DAY_NAMES[dayOfWeek]}`,
      };
    }
  }

  return { hasConflict: false };
}

// Convenience wrapper that uses the default prisma client
async function checkScheduleConflict(
  staffId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeId?: string
) {
  return checkScheduleConflictTx(prisma, staffId, dayOfWeek, startTime, endTime, excludeId);
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Create a single schedule entry
export async function createSchedule(data: ScheduleFormData): Promise<ActionResult<ScheduleListItem>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = scheduleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { staffId, dayOfWeek, startTime, endTime, shiftType, isAvailable } = validationResult.data;

  try {
    // Verify staff exists
    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { isActive: true },
    });

    if (!staff || !staff.isActive) {
      return { success: false, error: "Staff member not found or inactive" };
    }

    // Atomic conflict check + create inside a transaction
    const schedule = await prisma.$transaction(async (tx) => {
      const conflict = await checkScheduleConflictTx(tx, staffId, dayOfWeek, startTime, endTime);
      if (conflict.hasConflict) {
        throw new Error(`Schedule overlaps with existing shift (${conflict.conflictWith})`);
      }

      return tx.schedule.create({
        data: {
          staffId,
          dayOfWeek,
          startTime,
          endTime,
          shiftType,
          isAvailable,
        },
        include: scheduleListInclude,
      });
    });

    await logAudit({
      action: "SCHEDULE_CREATED",
      entityType: "Schedule",
      entityId: schedule.id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { staffId, dayOfWeek, startTime, endTime, shiftType },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error creating schedule:", error);
    const message = error instanceof Error ? error.message : "Failed to create schedule";
    return { success: false, error: message };
  }
}

// Update a schedule entry
export async function updateSchedule(
  id: string,
  data: ScheduleFormData
): Promise<ActionResult<ScheduleListItem>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = scheduleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { startTime, endTime, shiftType, isAvailable } = validationResult.data;

  try {
    // Atomic conflict check + update inside a transaction
    const schedule = await prisma.$transaction(async (tx) => {
      const existing = await tx.schedule.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error("Schedule not found");
      }

      const conflict = await checkScheduleConflictTx(tx, existing.staffId, existing.dayOfWeek, startTime, endTime, id);
      if (conflict.hasConflict) {
        throw new Error(`Schedule overlaps with existing shift (${conflict.conflictWith})`);
      }

      return tx.schedule.update({
        where: { id },
        data: {
          startTime,
          endTime,
          shiftType,
          isAvailable,
        },
        include: scheduleListInclude,
      });
    });

    await logAudit({
      action: "SCHEDULE_UPDATED",
      entityType: "Schedule",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { startTime, endTime, shiftType },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error updating schedule:", error);
    const message = error instanceof Error ? error.message : "Failed to update schedule";
    return { success: false, error: message };
  }
}

// Delete a schedule entry
export async function deleteSchedule(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const schedule = await prisma.schedule.findUnique({
      where: { id },
      select: { staffId: true, dayOfWeek: true, startTime: true, endTime: true },
    });

    await prisma.schedule.delete({ where: { id } });

    await logAudit({
      action: "SCHEDULE_DELETED",
      entityType: "Schedule",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: schedule ? { staffId: schedule.staffId, dayOfWeek: schedule.dayOfWeek } : undefined,
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting schedule:", error);
    return { success: false, error: "Failed to delete schedule" };
  }
}

// Set week schedule for a staff member (bulk create/update)
export async function setWeekSchedule(data: WeekScheduleFormData): Promise<ActionResult<ScheduleListItem[]>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = weekScheduleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { staffId, schedules } = validationResult.data;

  // Check for intra-batch overlaps (new entries conflicting with each other)
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      if (schedules[i].dayOfWeek !== schedules[j].dayOfWeek) continue;
      const aStart = timeToMinutes(schedules[i].startTime);
      const aEnd = timeToMinutes(schedules[i].endTime);
      const bStart = timeToMinutes(schedules[j].startTime);
      const bEnd = timeToMinutes(schedules[j].endTime);
      if (aStart < bEnd && aEnd > bStart) {
        return {
          success: false,
          error: `Overlapping shifts on ${DAY_NAMES[schedules[i].dayOfWeek]}: ${schedules[i].startTime}-${schedules[i].endTime} and ${schedules[j].startTime}-${schedules[j].endTime}`,
        };
      }
    }
  }

  try {
    // Verify staff exists
    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { isActive: true },
    });

    if (!staff || !staff.isActive) {
      return { success: false, error: "Staff member not found or inactive" };
    }

    // Atomic delete + create inside a transaction
    const createdSchedules = await prisma.$transaction(async (tx) => {
      await tx.schedule.deleteMany({
        where: { staffId },
      });

      const results: ScheduleListItem[] = [];
      for (const schedule of schedules) {
        const created = await tx.schedule.create({
          data: {
            staffId,
            dayOfWeek: schedule.dayOfWeek,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            shiftType: schedule.shiftType,
            isAvailable: schedule.isAvailable,
          },
          include: scheduleListInclude,
        });
        results.push(created);
      }
      return results;
    });

    await logAudit({
      action: "WEEK_SCHEDULE_SET",
      entityType: "Schedule",
      userId: authResult.userId,
      userRole: authResult.role,
      details: { staffId, shiftsCount: createdSchedules.length },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: createdSchedules };
  } catch (error) {
    console.error("Error setting week schedule:", error);
    const message = error instanceof Error ? error.message : "Failed to set week schedule";
    return { success: false, error: message };
  }
}

// Toggle availability for a schedule
export async function toggleScheduleAvailability(id: string): Promise<ActionResult<ScheduleListItem>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existing = await prisma.schedule.findUnique({
      where: { id },
      select: { isAvailable: true },
    });

    if (!existing) {
      return { success: false, error: "Schedule not found" };
    }

    const schedule = await prisma.schedule.update({
      where: { id },
      data: { isAvailable: !existing.isAvailable },
      include: scheduleListInclude,
    });

    await logAudit({
      action: "SCHEDULE_AVAILABILITY_TOGGLED",
      entityType: "Schedule",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { isAvailable: !existing.isAvailable },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error toggling availability:", error);
    return { success: false, error: "Failed to toggle availability" };
  }
}

// Get staff members with their schedules
export async function getStaffWithSchedules(): Promise<ActionResult<{
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  schedules: {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    shiftType: ShiftType;
    isAvailable: boolean;
  }[];
}[]>> {
  const authResult = await checkAuth("schedules:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const staff = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.STAFF, Role.ADMIN, Role.OWNER] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        schedules: {
          select: {
            id: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            shiftType: true,
            isAvailable: true,
          },
          orderBy: { dayOfWeek: "asc" },
        },
      },
      orderBy: { firstName: "asc" },
    });

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching staff with schedules:", error);
    return { success: false, error: "Failed to fetch staff schedules" };
  }
}

// Copy schedule from one staff to another
export async function copySchedule(
  fromStaffId: string,
  toStaffId: string
): Promise<ActionResult<ScheduleListItem[]>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Get source schedules
    const sourceSchedules = await prisma.schedule.findMany({
      where: { staffId: fromStaffId },
    });

    if (sourceSchedules.length === 0) {
      return { success: false, error: "Source staff has no schedules to copy" };
    }

    // Delete existing schedules for target staff
    await prisma.schedule.deleteMany({
      where: { staffId: toStaffId },
    });

    // Copy schedules
    const copiedSchedules = await Promise.all(
      sourceSchedules.map((schedule) =>
        prisma.schedule.create({
          data: {
            staffId: toStaffId,
            dayOfWeek: schedule.dayOfWeek,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            shiftType: schedule.shiftType,
            isAvailable: schedule.isAvailable,
          },
          include: scheduleListInclude,
        })
      )
    );

    await logAudit({
      action: "SCHEDULE_COPIED",
      entityType: "Schedule",
      userId: authResult.userId,
      userRole: authResult.role,
      details: { fromStaffId, toStaffId, shiftsCount: copiedSchedules.length },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: copiedSchedules };
  } catch (error) {
    console.error("Error copying schedule:", error);
    return { success: false, error: "Failed to copy schedule" };
  }
}

// Reassign a schedule to a different day (used by drag-and-drop)
export async function reassignSchedule(
  id: string,
  newDayOfWeek: number
): Promise<ActionResult<ScheduleListItem>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  if (newDayOfWeek < 0 || newDayOfWeek > 6) {
    return { success: false, error: "Invalid day of week" };
  }

  try {
    // Atomic conflict check + update inside a transaction
    const schedule = await prisma.$transaction(async (tx) => {
      const existing = await tx.schedule.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error("Schedule not found");
      }

      const conflict = await checkScheduleConflictTx(
        tx,
        existing.staffId,
        newDayOfWeek,
        existing.startTime,
        existing.endTime,
        id
      );
      if (conflict.hasConflict) {
        throw new Error(`Cannot move: overlaps with existing shift (${conflict.conflictWith})`);
      }

      return tx.schedule.update({
        where: { id },
        data: { dayOfWeek: newDayOfWeek },
        include: scheduleListInclude,
      });
    });

    await logAudit({
      action: "SCHEDULE_REASSIGNED",
      entityType: "Schedule",
      entityId: id,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { newDayOfWeek },
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error reassigning schedule:", error);
    const message = error instanceof Error ? error.message : "Failed to reassign schedule";
    return { success: false, error: message };
  }
}

// Get schedule availability for a specific date (considering day of week)
export async function getAvailabilityForDate(date: Date): Promise<ActionResult<{
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}[]>> {
  const authResult = await checkAuth("schedules:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const dayOfWeek = date.getDay();

  try {
    const schedules = await prisma.schedule.findMany({
      where: { dayOfWeek },
      include: {
        staff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const availability = schedules.map((schedule) => ({
      staffId: schedule.staffId,
      staffName: `${schedule.staff.firstName} ${schedule.staff.lastName}`,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      isAvailable: schedule.isAvailable,
    }));

    return { success: true, data: availability };
  } catch (error) {
    console.error("Error fetching availability:", error);
    return { success: false, error: "Failed to fetch availability" };
  }
}
