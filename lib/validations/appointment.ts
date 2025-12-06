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

export type AppointmentFormData = z.infer<typeof appointmentSchema>;
export type AppointmentFormInput = z.input<typeof appointmentSchema>;
export type AppointmentStatusFormData = z.infer<typeof appointmentStatusSchema>;
export type RescheduleFormData = z.infer<typeof rescheduleSchema>;
export type AppointmentFilterData = z.infer<typeof appointmentFilterSchema>;
