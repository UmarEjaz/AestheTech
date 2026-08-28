import type { AppointmentStatus } from "@prisma/client";
import type { AppointmentListItem } from "@/lib/actions/appointment";

// Status → Tailwind color classes, shared by the FullCalendar views and the staff-lane grid so the
// two never drift apart. bg/border/text are applied to event/appointment blocks and the legend.
export const STATUS_COLORS: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  SCHEDULED: { bg: "bg-blue-100 dark:bg-blue-900/30", border: "border-blue-500", text: "text-blue-800 dark:text-blue-200" },
  CONFIRMED: { bg: "bg-violet-100 dark:bg-violet-900/30", border: "border-violet-500", text: "text-violet-800 dark:text-violet-200" },
  IN_PROGRESS: { bg: "bg-amber-100 dark:bg-amber-900/30", border: "border-amber-500", text: "text-amber-800 dark:text-amber-200" },
  COMPLETED: { bg: "bg-green-100 dark:bg-green-900/30", border: "border-green-500", text: "text-green-800 dark:text-green-200" },
  CANCELLED: { bg: "bg-red-100 dark:bg-red-900/30", border: "border-red-400", text: "text-red-600 dark:text-red-400" },
  NO_SHOW: { bg: "bg-orange-100 dark:bg-orange-900/30", border: "border-orange-400", text: "text-orange-600 dark:text-orange-400" },
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

export const STATUS_ORDER: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

// Statuses whose appointments may be dragged to reschedule/reassign.
export const DRAGGABLE_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

// One service's slice of an appointment: which provider is busy, when, and what.
export interface AppointmentSegment {
  appointment: AppointmentListItem;
  serviceIndex: number; // position in appointment.services (0 = primary)
  staffId: string;
  staffName: string;
  serviceName: string;
  start: Date;
  end: Date;
}

// Services run BACK-TO-BACK from the appointment's start (service[0] first, then service[1], …).
// We derive each service's [start, end] from the appointment startTime + the ordered durations,
// mirroring the server's computeSegments — so the lane grid can place each service in its
// provider's column at the right time WITHOUT needing segmentStart/segmentEnd on the client.
export function appointmentSegments(appt: AppointmentListItem): AppointmentSegment[] {
  const segments: AppointmentSegment[] = [];
  let cursorMs = new Date(appt.startTime).getTime();
  appt.services.forEach((svc, serviceIndex) => {
    const start = new Date(cursorMs);
    const end = new Date(cursorMs + svc.duration * 60_000);
    segments.push({
      appointment: appt,
      serviceIndex,
      staffId: svc.staff.id,
      staffName: `${svc.staff.firstName} ${svc.staff.lastName ?? ""}`.trim(),
      serviceName: svc.service.name,
      start,
      end,
    });
    cursorMs = end.getTime();
  });
  return segments;
}
