"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { EventClickArg, DateSelectArg, DatesSetArg, EventDropArg } from "@fullcalendar/core";
import { AppointmentStatus } from "@prisma/client";
import { AppointmentListItem, getAppointmentsForCalendar, rescheduleAppointment } from "@/lib/actions/appointment";
import { toast } from "sonner";
import { AppointmentDetailModal } from "./appointment-detail-modal";

interface AppointmentCalendarProps {
  initialAppointments: AppointmentListItem[];
  canManage?: boolean;
  staffFilter?: string;
  businessHoursStart?: string;
  businessHoursEnd?: string;
}

const statusColors: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  SCHEDULED: { bg: "bg-blue-100 dark:bg-blue-900/30", border: "border-blue-500", text: "text-blue-800 dark:text-blue-200" },
  CONFIRMED: { bg: "bg-green-100 dark:bg-green-900/30", border: "border-green-500", text: "text-green-800 dark:text-green-200" },
  IN_PROGRESS: { bg: "bg-yellow-100 dark:bg-yellow-900/30", border: "border-yellow-500", text: "text-yellow-800 dark:text-yellow-200" },
  COMPLETED: { bg: "bg-gray-100 dark:bg-gray-800/30", border: "border-gray-400", text: "text-gray-600 dark:text-gray-400" },
  CANCELLED: { bg: "bg-red-100 dark:bg-red-900/30", border: "border-red-400", text: "text-red-600 dark:text-red-400" },
  NO_SHOW: { bg: "bg-orange-100 dark:bg-orange-900/30", border: "border-orange-400", text: "text-orange-600 dark:text-orange-400" },
};

// Statuses that allow dragging (defined outside component to avoid recreation on each render)
const DRAGGABLE_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

export function AppointmentCalendar({
  initialAppointments,
  canManage = false,
  staffFilter,
  businessHoursStart = "08:00",
  businessHoursEnd = "20:00",
}: AppointmentCalendarProps) {
  const router = useRouter();
  const [appointments, setAppointments] = useState<AppointmentListItem[]>(initialAppointments);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentListItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentViewDates, setCurrentViewDates] = useState<{ start: Date; end: Date } | null>(null);

  // Convert appointments to FullCalendar events
  const events = appointments.map((apt) => {
    const isRecurring = apt.series?.isActive;
    const clientName = `${apt.client.firstName}${apt.client.lastName ? ` ${apt.client.lastName}` : ""}`;
    const walkInLabel = apt.client.isWalkIn ? " (Walk-in)" : "";
    const recurringIndicator = isRecurring ? "↻ " : "";

    return {
      id: apt.id,
      title: `${recurringIndicator}${clientName}${walkInLabel} - ${apt.service.name}`,
      start: apt.startTime,
      end: apt.endTime,
      editable: canManage && DRAGGABLE_STATUSES.includes(apt.status),
      extendedProps: {
        appointment: apt,
        status: apt.status,
        isRecurring,
      },
      classNames: [
        statusColors[apt.status].bg,
        statusColors[apt.status].text,
        "border-l-4",
        statusColors[apt.status].border,
        isRecurring ? "fc-event-recurring" : "",
      ].filter(Boolean),
    };
  });

  // Handle date range change
  const handleDatesSet = useCallback(
    async (arg: DatesSetArg) => {
      setCurrentViewDates({ start: arg.start, end: arg.end });

      const result = await getAppointmentsForCalendar({
        startDate: arg.start,
        endDate: arg.end,
        staffId: staffFilter,
      });

      if (result.success) {
        setAppointments(result.data);
      }
    },
    [staffFilter]
  );

  // Refresh appointments (called when modal makes changes)
  const refreshAppointments = useCallback(async () => {
    if (!currentViewDates) return;

    const result = await getAppointmentsForCalendar({
      startDate: currentViewDates.start,
      endDate: currentViewDates.end,
      staffId: staffFilter,
    });

    if (result.success) {
      setAppointments(result.data);
    }
  }, [currentViewDates, staffFilter]);

  // Handle event click
  const handleEventClick = (arg: EventClickArg) => {
    const appointment = arg.event.extendedProps.appointment as AppointmentListItem;
    setSelectedAppointment(appointment);
    setIsModalOpen(true);
  };

  // Handle date selection (for creating new appointments)
  const handleDateSelect = (arg: DateSelectArg) => {
    if (canManage) {
      const startTime = arg.start.toISOString();
      router.push(`/dashboard/appointments/new?startTime=${encodeURIComponent(startTime)}`);
    }
  };

  // Handle drag and drop reschedule
  const handleEventDrop = useCallback(
    async (arg: EventDropArg) => {
      const appointment = arg.event.extendedProps.appointment as AppointmentListItem;
      const newStartTime = arg.event.start;

      if (!newStartTime) {
        arg.revert();
        return;
      }

      // Optimistically update UI is handled by FullCalendar
      const result = await rescheduleAppointment(appointment.id, {
        startTime: newStartTime,
      });

      if (!result.success) {
        arg.revert();
        toast.error(result.error || "Failed to reschedule appointment");
      } else {
        toast.success("Appointment rescheduled successfully");
        // Refresh appointments to get updated data
        await refreshAppointments();
      }
    },
    [refreshAppointments]
  );

  // Refresh appointments after modal closes
  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedAppointment(null);
  };

  return (
    <div className="appointment-calendar">
      <style jsx global>{`
        .appointment-calendar .fc {
          --fc-border-color: hsl(var(--border));
          --fc-button-bg-color: hsl(var(--primary));
          --fc-button-border-color: hsl(var(--primary));
          --fc-button-hover-bg-color: hsl(var(--primary) / 0.9);
          --fc-button-hover-border-color: hsl(var(--primary) / 0.9);
          --fc-button-active-bg-color: hsl(var(--primary) / 0.8);
          --fc-button-active-border-color: hsl(var(--primary) / 0.8);
          --fc-today-bg-color: hsl(var(--primary) / 0.1);
        }

        .appointment-calendar .fc-theme-standard td,
        .appointment-calendar .fc-theme-standard th {
          border-color: hsl(var(--border));
        }

        .appointment-calendar .fc-col-header-cell {
          background: hsl(var(--muted));
          padding: 8px 0;
        }

        .appointment-calendar .fc-col-header-cell-cushion {
          color: hsl(var(--foreground));
          font-weight: 500;
        }

        .appointment-calendar .fc-daygrid-day-number,
        .appointment-calendar .fc-timegrid-slot-label-cushion {
          color: hsl(var(--foreground));
        }

        .appointment-calendar .fc-event {
          cursor: pointer;
          padding: 2px 4px;
          font-size: 0.75rem;
          border-radius: 4px;
        }

        .appointment-calendar .fc-event.fc-event-draggable {
          cursor: grab;
        }

        .appointment-calendar .fc-event.fc-event-draggable:active {
          cursor: grabbing;
        }

        .appointment-calendar .fc-timegrid-event {
          border-radius: 4px;
          padding: 4px;
        }

        .appointment-calendar .fc-event-title {
          font-weight: 500;
        }

        .appointment-calendar .fc-toolbar-title {
          color: hsl(var(--foreground));
          font-size: 1.25rem !important;
        }

        .appointment-calendar .fc-button {
          font-size: 0.875rem !important;
          padding: 0.5rem 1rem !important;
        }

        .dark .appointment-calendar .fc-day-today {
          background-color: hsl(var(--primary) / 0.15) !important;
        }

        .appointment-calendar .fc-event-recurring {
          border-right: 3px solid hsl(var(--primary) / 0.6);
        }

        .appointment-calendar .fc-event-recurring .fc-event-title::before {
          content: "";
        }
      `}</style>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        events={events}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        selectable={canManage}
        select={handleDateSelect}
        datesSet={handleDatesSet}
        slotMinTime={businessHoursStart}
        slotMaxTime={businessHoursEnd}
        slotDuration="00:30:00"
        allDaySlot={false}
        nowIndicator={true}
        height="auto"
        eventDisplay="block"
        dayMaxEvents={3}
        weekends={true}
      />

      {selectedAppointment && (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          isOpen={isModalOpen}
          onClose={handleModalClose}
          onDataChange={refreshAppointments}
          canManage={canManage}
        />
      )}
    </div>
  );
}
