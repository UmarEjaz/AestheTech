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

    // Check for existing schedule on this day
    const existing = await prisma.schedule.findFirst({
      where: { staffId, dayOfWeek },
    });

    if (existing) {
      return { success: false, error: `Schedule already exists for ${DAY_NAMES[dayOfWeek]}. Please edit instead.` };
    }

    const schedule = await prisma.schedule.create({
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

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error creating schedule:", error);
    return { success: false, error: "Failed to create schedule" };
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
    const existing = await prisma.schedule.findUnique({
      where: { id },
    });

    if (!existing) {
      return { success: false, error: "Schedule not found" };
    }

    const schedule = await prisma.schedule.update({
      where: { id },
      data: {
        startTime,
        endTime,
        shiftType,
        isAvailable,
      },
      include: scheduleListInclude,
    });

    revalidatePath("/dashboard/schedules");
    return { success: true, data: schedule };
  } catch (error) {
    console.error("Error updating schedule:", error);
    return { success: false, error: "Failed to update schedule" };
  }
}

// Delete a schedule entry
export async function deleteSchedule(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("schedules:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    await prisma.schedule.delete({ where: { id } });

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

  try {
    // Verify staff exists
    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { isActive: true },
    });

    if (!staff || !staff.isActive) {
      return { success: false, error: "Staff member not found or inactive" };
    }

    // Delete existing schedules for this staff
    await prisma.schedule.deleteMany({
      where: { staffId },
    });

    // Create new schedules
    const createdSchedules = await Promise.all(
      schedules.map((schedule) =>
        prisma.schedule.create({
          data: {
            staffId,
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

    revalidatePath("/dashboard/schedules");
    return { success: true, data: createdSchedules };
  } catch (error) {
    console.error("Error setting week schedule:", error);
    return { success: false, error: "Failed to set week schedule" };
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

    revalidatePath("/dashboard/schedules");
    return { success: true, data: copiedSchedules };
  } catch (error) {
    console.error("Error copying schedule:", error);
    return { success: false, error: "Failed to copy schedule" };
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
