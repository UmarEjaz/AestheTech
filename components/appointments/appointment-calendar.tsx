"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { EventClickArg, DateSelectArg, DatesSetArg, EventDropArg } from "@fullcalendar/core";
import { AppointmentStatus } from "@prisma/client";
import { AppointmentListItem, getAppointmentsForCalendar, rescheduleAppointment } from "@/lib/actions/appointment";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppointmentDetailModal } from "./appointment-detail-modal";

const CALENDAR_VIEWS = [
  { key: "dayGridMonth", label: "month" },
  { key: "timeGridWeek", label: "week" },
  { key: "timeGridDay", label: "day" },
] as const;

interface AppointmentCalendarProps {
  initialAppointments: AppointmentListItem[];
  canCreate?: boolean;
  canUpdate?: boolean;
  canCancel?: boolean;
  canDelete?: boolean;
  staff?: { id: string; firstName: string; lastName: string }[];
  businessHoursStart?: string;
  businessHoursEnd?: string;
  timezone: string;
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
  canCreate = false,
  canUpdate = false,
  canCancel = false,
  canDelete = false,
  staff = [],
  businessHoursStart = "08:00",
  businessHoursEnd = "20:00",
  timezone,
}: AppointmentCalendarProps) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const [appointments, setAppointments] = useState<AppointmentListItem[]>(initialAppointments);
  // "all" = no staff filter; otherwise a staff user id.
  const [staffFilter, setStaffFilter] = useState<string>("all");
  // Driven by datesSet so our custom toolbar stays in sync with the calendar.
  const [viewTitle, setViewTitle] = useState("");
  const [currentView, setCurrentView] = useState("timeGridWeek");

  const calendarApi = () => calendarRef.current?.getApi();
  // Track only the id; derive the live object from `appointments` so the open modal
  // always reflects the latest data (e.g. a deposit just recorded), not a stale snapshot.
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentViewDates, setCurrentViewDates] = useState<{ start: Date; end: Date } | null>(null);

  const selectedAppointment =
    appointments.find((apt) => apt.id === selectedAppointmentId) ?? null;

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
      editable: canUpdate && DRAGGABLE_STATUSES.includes(apt.status),
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
      setViewTitle(arg.view.title);
      setCurrentView(arg.view.type);

      const result = await getAppointmentsForCalendar({
        startDate: arg.start,
        endDate: arg.end,
        staffId: staffFilter === "all" ? undefined : staffFilter,
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
      staffId: staffFilter === "all" ? undefined : staffFilter,
    });

    if (result.success) {
      setAppointments(result.data);
    }
  }, [currentViewDates, staffFilter]);

  // Change the staff filter and immediately refetch for the current view range.
  const handleStaffFilterChange = useCallback(
    async (value: string) => {
      setStaffFilter(value);
      if (!currentViewDates) return;
      const result = await getAppointmentsForCalendar({
        startDate: currentViewDates.start,
        endDate: currentViewDates.end,
        staffId: value === "all" ? undefined : value,
      });
      if (result.success) {
        setAppointments(result.data);
      }
    },
    [currentViewDates]
  );

  // Handle event click
  const handleEventClick = (arg: EventClickArg) => {
    const appointment = arg.event.extendedProps.appointment as AppointmentListItem;
    setSelectedAppointmentId(appointment.id);
    setIsModalOpen(true);
  };

  // Handle date selection (for creating new appointments)
  const handleDateSelect = (arg: DateSelectArg) => {
    if (canCreate) {
      // arg.startStr is offset-aware in the salon timezone (e.g. "...T10:00:00+05:00"),
      // so the clicked wall-clock time round-trips correctly. arg.start.toISOString()
      // would mislabel the wall clock as UTC.
      const startTime = arg.startStr;
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
    setSelectedAppointmentId(null);
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
          padding: 2px 4px;
        }

        /* Taller half-hour rows so short (20-min) events stay proportional but still
           have room for two lines of text. 30-min cell = 3.25rem → 20-min ≈ 34px. */
        .appointment-calendar .fc-timegrid-slot {
          height: 3.25rem;
        }

        /* Keep custom event content clipped inside the event box (no overflow). */
        .appointment-calendar .fc-timegrid-event .fc-event-main {
          overflow: hidden;
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

      {/* Custom single-row toolbar: nav · title · staff filter + view switcher */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" onClick={() => calendarApi()?.prev()} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" onClick={() => calendarApi()?.next()} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => calendarApi()?.today()}>
            today
          </Button>
        </div>

        <div className="order-last w-full text-center text-lg font-semibold sm:order-none sm:w-auto sm:flex-1">
          {viewTitle}
        </div>

        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          {staff.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="hidden text-sm font-medium text-foreground sm:inline">Staff</span>
              <Select value={staffFilter} onValueChange={handleStaffFilterChange}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  {staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.firstName} {member.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="inline-flex overflow-hidden rounded-md border">
            {CALENDAR_VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => {
                  calendarApi()?.changeView(v.key);
                  setCurrentView(v.key);
                }}
                className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                  currentView === v.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <FullCalendar
        ref={calendarRef}
        timeZone={timezone}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
        initialView="timeGridWeek"
        headerToolbar={false}
        views={{
          timeGridWeek: { dayHeaderFormat: { weekday: "short", day: "numeric" } },
          timeGridDay: { dayHeaderFormat: { weekday: "long", month: "short", day: "numeric" } },
        }}
        eventMinHeight={24}
        events={events}
        eventContent={(arg) => {
          const apt = arg.event.extendedProps.appointment as AppointmentListItem;
          const name = `${apt.client.firstName}${apt.client.lastName ? ` ${apt.client.lastName}` : ""}`;
          const recurring = apt.series?.isActive ? "↻ " : "";
          const walkIn = apt.client.isWalkIn ? " (Walk-in)" : "";
          return (
            <div className="h-full overflow-hidden leading-tight px-0.5">
              <div className="truncate font-semibold">{recurring}{name}{walkIn}</div>
              <div className="truncate text-[0.7rem] opacity-90">
                {arg.timeText}
                {apt.service?.name ? ` · ${apt.service.name}` : ""}
              </div>
            </div>
          );
        }}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        selectable={canCreate}
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
          canUpdate={canUpdate}
          canCancel={canCancel}
          canDelete={canDelete}
          timezone={timezone}
        />
      )}
    </div>
  );
}
