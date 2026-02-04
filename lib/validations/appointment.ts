import { z } from "zod";

// Appointment status enum matching Prisma
export const appointmentStatusEnum = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export type AppointmentStatusType = z.infer<typeof appointmentStatusEnum>;

// Recurrence pattern enum matching Prisma (extended)
export const recurrencePatternEnum = z.enum([
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "CUSTOM",
  "SPECIFIC_DAYS",
  "NTH_WEEKDAY",
]);

export type RecurrencePatternType = z.infer<typeof recurrencePatternEnum>;

// Recurrence end type enum matching Prisma
export const recurrenceEndTypeEnum = z.enum([
  "NEVER",
  "AFTER_COUNT",
  "BY_DATE",
]);

export type RecurrenceEndTypeType = z.infer<typeof recurrenceEndTypeEnum>;

// Schema for creating/updating appointments
export const appointmentSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  serviceId: z.string().min(1, "Service is required"),
  staffId: z.string().min(1, "Staff member is required"),
  startTime: z.coerce.date({ message: "Start time is required" }),
  notes: z.string().max(500, "Notes must be at most 500 characters").optional().or(z.literal("")),
});

// Schema for updating appointment status
export const appointmentStatusSchema = z.object({
  status: appointmentStatusEnum,
});

// Schema for rescheduling
export const rescheduleSchema = z.object({
  startTime: z.coerce.date({ message: "Start time is required" }),
  staffId: z.string().min(1, "Staff member is required").optional(),
});

// Schema for filtering appointments
export const appointmentFilterSchema = z.object({
  date: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  staffId: z.string().optional(),
  clientId: z.string().optional(),
  status: appointmentStatusEnum.optional(),
});

// Schema for creating recurring appointment series (extended)
export const recurringAppointmentSchema = z.object({
  // Required fields
  clientId: z.string().min(1, "Client is required"),
  serviceId: z.string().min(1, "Service is required"),
  staffId: z.string().min(1, "Staff member is required"),
  pattern: recurrencePatternEnum,
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format"),

  // Day selection (required for most patterns)
  dayOfWeek: z.number().min(0).max(6).optional(),

  // Pattern-specific fields
  customWeeks: z.number().min(1).max(52).optional(), // For CUSTOM pattern
  specificDays: z.array(z.number().min(0).max(6)).optional(), // For SPECIFIC_DAYS: [0,1,2,3,4,5,6]
  nthWeek: z.number().min(1).max(5).optional(), // For NTH_WEEKDAY: 1-4, or 5 for "last"

  // End conditions
  endType: recurrenceEndTypeEnum.default("NEVER"),
  endAfterCount: z.number().min(1).max(365).optional(), // For AFTER_COUNT
  endByDate: z.coerce.date().optional(), // For BY_DATE

  // Start date for the series (defaults to now if not provided)
  startDate: z.coerce.date().optional(),

  // Optional settings
  lockedPrice: z.number().min(0).optional(), // Lock price at creation
  bufferMinutes: z.number().min(0).max(120).optional(), // Buffer between appointments
  notes: z.string().max(500, "Notes must be at most 500 characters").optional().or(z.literal("")),

  // Conflict resolution - user selections from ConflictResolutionUI
  selectedAlternatives: z.array(z.object({
    originalDate: z.coerce.date(),
    alternative: z.object({
      date: z.coerce.date(),
      startTime: z.coerce.date(),
      endTime: z.coerce.date(),
      staffId: z.string(),
      staffName: z.string(),
    }),
  })).optional(),
  skipDates: z.array(z.coerce.date()).optional(), // Dates user explicitly wants to skip
}).superRefine((data, ctx) => {
  // Validate pattern-specific requirements
  switch (data.pattern) {
    case "DAILY":
      // No additional requirements for daily
      break;

    case "WEEKLY":
    case "BIWEEKLY":
    case "MONTHLY":
      if (data.dayOfWeek === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Day of week is required for this pattern",
          path: ["dayOfWeek"],
        });
      }
      break;

    case "CUSTOM":
      if (data.dayOfWeek === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Day of week is required for custom pattern",
          path: ["dayOfWeek"],
        });
      }
      if (!data.customWeeks || data.customWeeks < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Number of weeks is required for custom pattern",
          path: ["customWeeks"],
        });
      }
      break;

    case "SPECIFIC_DAYS":
      if (!data.specificDays || data.specificDays.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one day must be selected",
          path: ["specificDays"],
        });
      }
      break;

    case "NTH_WEEKDAY":
      if (data.dayOfWeek === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Day of week is required for nth weekday pattern",
          path: ["dayOfWeek"],
        });
      }
      if (!data.nthWeek || data.nthWeek < 1 || data.nthWeek > 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Week number (1-5) is required for nth weekday pattern",
          path: ["nthWeek"],
        });
      }
      break;
  }

  // Validate end condition requirements
  switch (data.endType) {
    case "AFTER_COUNT":
      if (!data.endAfterCount || data.endAfterCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Number of occurrences is required",
          path: ["endAfterCount"],
        });
      }
      break;

    case "BY_DATE":
      if (!data.endByDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date is required",
          path: ["endByDate"],
        });
      } else if (data.endByDate < new Date()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date must be in the future",
          path: ["endByDate"],
        });
      }
      break;
  }
});

// Schema for updating recurring series
export const updateRecurringSeriesSchema = z.object({
  staffId: z.string().min(1, "Staff member is required").optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format").optional(),
  notes: z.string().max(500, "Notes must be at most 500 characters").optional().or(z.literal("")),
  bufferMinutes: z.number().min(0).max(120).optional(),
});

// Schema for adding exception date
export const exceptionDateSchema = z.object({
  seriesId: z.string().min(1, "Series ID is required"),
  date: z.coerce.date({ message: "Date is required" }),
  reason: z.string().max(200, "Reason must be at most 200 characters").optional().or(z.literal("")),
});

// Schema for pause/resume series
export const pauseSeriesSchema = z.object({
  seriesId: z.string().min(1, "Series ID is required"),
  pausedUntil: z.coerce.date().optional(), // Optional: auto-resume date
});

// Schema for extending series
export const extendSeriesSchema = z.object({
  seriesId: z.string().min(1, "Series ID is required"),
  additionalMonths: z.number().min(1).max(12).default(3),
});

// Schema for cloning series
export const cloneSeriesSchema = z.object({
  seriesId: z.string().min(1, "Series ID is required"),
  newClientId: z.string().optional(), // If not provided, use same client
  newStaffId: z.string().optional(), // If not provided, use same staff
  newTimeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format").optional(),
});

// Schema for cancel from date
export const cancelFromDateSchema = z.object({
  seriesId: z.string().min(1, "Series ID is required"),
  fromDate: z.coerce.date({ message: "From date is required" }),
});

// Type exports
export type AppointmentFormData = z.infer<typeof appointmentSchema>;
export type AppointmentFormInput = z.input<typeof appointmentSchema>;
export type AppointmentStatusFormData = z.infer<typeof appointmentStatusSchema>;
export type RescheduleFormData = z.infer<typeof rescheduleSchema>;
export type AppointmentFilterData = z.infer<typeof appointmentFilterSchema>;
export type RecurringAppointmentFormData = z.infer<typeof recurringAppointmentSchema>;
export type UpdateRecurringSeriesFormData = z.infer<typeof updateRecurringSeriesSchema>;
export type ExceptionDateFormData = z.infer<typeof exceptionDateSchema>;
export type PauseSeriesFormData = z.infer<typeof pauseSeriesSchema>;
export type ExtendSeriesFormData = z.infer<typeof extendSeriesSchema>;
export type CloneSeriesFormData = z.infer<typeof cloneSeriesSchema>;
export type CancelFromDateFormData = z.infer<typeof cancelFromDateSchema>;
