import { z } from "zod";
import { ShiftType } from "@prisma/client";

// Time format validation (HH:mm)
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Schema for creating/updating a schedule
export const scheduleSchema = z.object({
  staffId: z.string().min(1, "Staff member is required"),
  dayOfWeek: z
    .number()
    .int()
    .min(0, "Day must be between 0 (Sunday) and 6 (Saturday)")
    .max(6, "Day must be between 0 (Sunday) and 6 (Saturday)"),
  startTime: z
    .string()
    .regex(timeRegex, "Start time must be in HH:mm format"),
  endTime: z
    .string()
    .regex(timeRegex, "End time must be in HH:mm format"),
  shiftType: z.nativeEnum(ShiftType).default(ShiftType.REGULAR),
  isAvailable: z.boolean().default(true),
}).refine(
  (data) => {
    const start = data.startTime.split(":").map(Number);
    const end = data.endTime.split(":").map(Number);
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    return endMinutes > startMinutes;
  },
  {
    message: "End time must be after start time",
    path: ["endTime"],
  }
);

// Schema for bulk schedule creation (week template)
export const weekScheduleSchema = z.object({
  staffId: z.string().min(1, "Staff member is required"),
  schedules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(timeRegex),
      endTime: z.string().regex(timeRegex),
      shiftType: z.nativeEnum(ShiftType).default(ShiftType.REGULAR),
      isAvailable: z.boolean().default(true),
    })
  ),
});

// Schema for time-off request
export const timeOffSchema = z.object({
  staffId: z.string().min(1, "Staff member is required"),
  startDate: z.coerce.date({ message: "Start date is required" }),
  endDate: z.coerce.date({ message: "End date is required" }),
  reason: z
    .string()
    .max(500, "Reason must be less than 500 characters")
    .optional()
    .or(z.literal("")),
}).refine(
  (data) => data.endDate >= data.startDate,
  {
    message: "End date must be on or after start date",
    path: ["endDate"],
  }
);

// Schema for schedule search/filter
export const scheduleSearchSchema = z.object({
  staffId: z.string().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  shiftType: z.nativeEnum(ShiftType).optional(),
});

// Types
export type ScheduleFormData = z.infer<typeof scheduleSchema>;
export type WeekScheduleFormData = z.infer<typeof weekScheduleSchema>;
export type TimeOffFormData = z.infer<typeof timeOffSchema>;
export type ScheduleSearchParams = z.input<typeof scheduleSearchSchema>;
