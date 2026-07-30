"use client";

import {
  useState,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { DateClickArg } from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { TZDate } from "@date-fns/tz";
import { addMinutes, addDays } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
import { EventClickArg, DatesSetArg, EventDropArg } from "@fullcalendar/core";
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
  currencyCode: string;
}

const statusColors: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  SCHEDULED: { bg: "bg-blue-100 dark:bg-blue-900/30", border: "border-blue-500", text: "text-blue-800 dark:text-blue-200" },
  CONFIRMED: { bg: "bg-violet-100 dark:bg-violet-900/30", border: "border-violet-500", text: "text-violet-800 dark:text-violet-200" },
  IN_PROGRESS: { bg: "bg-amber-100 dark:bg-amber-900/30", border: "border-amber-500", text: "text-amber-800 dark:text-amber-200" },
  COMPLETED: { bg: "bg-green-100 dark:bg-green-900/30", border: "border-green-500", text: "text-green-800 dark:text-green-200" },
  CANCELLED: { bg: "bg-red-100 dark:bg-red-900/30", border: "border-red-400", text: "text-red-600 dark:text-red-400" },
  NO_SHOW: { bg: "bg-orange-100 dark:bg-orange-900/30", border: "border-orange-400", text: "text-orange-600 dark:text-orange-400" },
};

// Human labels for the status color legend shown under the calendar.
const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};
const STATUS_ORDER: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];

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
  currencyCode,
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
  // Date nav, staff filter, and modal refreshes all fetch concurrently. Stamp each fetch with a
  // sequence number and only apply the newest response, so a slow earlier request can't overwrite
  // the latest view. (Server actions aren't fetch-cancellable, so a sequence guard is the tool.)
  const fetchSeqRef = useRef(0);
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
    // All service names, comma-separated (e.g. "Beard Trim, Express Facial").
    const serviceLabel = apt.services.map((s) => s.service.name).join(", ");

    return {
      id: apt.id,
      title: `${recurringIndicator}${clientName}${walkInLabel} - ${serviceLabel}`,
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

      const seq = ++fetchSeqRef.current;
      const result = await getAppointmentsForCalendar({
        startDate: arg.start,
        endDate: arg.end,
        staffId: staffFilter === "all" ? undefined : staffFilter,
      });

      if (seq === fetchSeqRef.current && result.success) {
        setAppointments(result.data);
      }
    },
    [staffFilter]
  );

  // Refresh appointments (called when modal makes changes)
  const refreshAppointments = useCallback(async () => {
    if (!currentViewDates) return;

    const seq = ++fetchSeqRef.current;
    const result = await getAppointmentsForCalendar({
      startDate: currentViewDates.start,
      endDate: currentViewDates.end,
      staffId: staffFilter === "all" ? undefined : staffFilter,
    });

    if (seq === fetchSeqRef.current && result.success) {
      setAppointments(result.data);
    }
  }, [currentViewDates, staffFilter]);

  // Change the staff filter and immediately refetch for the current view range.
  const handleStaffFilterChange = useCallback(
    async (value: string) => {
      setStaffFilter(value);
      if (!currentViewDates) return;
      const seq = ++fetchSeqRef.current;
      const result = await getAppointmentsForCalendar({
        startDate: currentViewDates.start,
        endDate: currentViewDates.end,
        staffId: value === "all" ? undefined : value,
      });
      if (seq === fetchSeqRef.current && result.success) {
        setAppointments(result.data);
      }
    },
    [currentViewDates]
  );

  // Handle event click
  const handleEventClick = (arg: EventClickArg) => {
    const appointment = arg.event.extendedProps.appointment as AppointmentListItem;
    // If this click came from inside the "+N more" popover, close the popover so it doesn't
    // linger overlapping the details drawer.
    if (typeof document !== "undefined") {
      (document.querySelector(".fc-popover .fc-popover-close") as HTMLElement | null)?.click();
    }
    // Drop any pending double-click stamp so opening the drawer can't later pair with a slot click.
    dblClickAtRef.current = 0;
    lastSlotClickRef.current = null;
    setSelectedAppointmentId(appointment.id);
    setIsModalOpen(true);
  };

  // DOUBLE-click an empty slot to create an appointment there (single click just highlights it).
  // FullCalendar's `dateClick` gives us the slot's date, and the browser's native `dblclick` tells
  // us it was a double-click — but the two fire in an unreliable order (FC's dateClick can arrive
  // AFTER the native dblclick). So we record a timestamp for each and navigate when BOTH have
  // happened within a short window; whichever fires second triggers it. A single click never sets
  // the dblclick timestamp, and double-clicking an event fires eventClick (not dateClick), so
  // neither path opens the create screen by mistake.
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSlotClickRef = useRef<{ dateStr: string; time: number } | null>(null);
  const dblClickAtRef = useRef<number>(0);
  const tryOpenCreateFromDoubleClick = () => {
    if (!canCreate) return;
    const slot = lastSlotClickRef.current;
    const now = Date.now();
    if (slot && now - slot.time < 600 && now - dblClickAtRef.current < 600) {
      lastSlotClickRef.current = null;
      dblClickAtRef.current = 0;
      // arg.dateStr is offset-aware in the salon timezone, so the wall-clock time round-trips.
      router.push(`/dashboard/appointments/new?startTime=${encodeURIComponent(slot.dateStr)}`);
    }
  };
  const handleDateClick = (arg: DateClickArg) => {
    lastSlotClickRef.current = { dateStr: arg.dateStr, time: Date.now() };
    const api = calendarApi();
    if (api && canCreate) {
      // Highlight the clicked slot in grey (like before) WITHOUT navigating — double-click navigates.
      api.select(arg.date, addMinutes(arg.date, 30));
      // Sync the keyboard cursor and focus the grid so arrow keys continue from the clicked slot.
      kbCursorRef.current = new Date(arg.date.getTime());
      containerRef.current?.focus();
    }
    tryOpenCreateFromDoubleClick();
  };
  const handleCalendarDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Only a double-click on an EMPTY grid slot may arm the create gesture. A double-click on an
    // event, a day header, the toolbar, or the legend must NOT stamp — otherwise its stamp could
    // pair with a later single slot click and open the create screen on one click.
    const target = e.target as HTMLElement;
    const onEmptySlot =
      target.closest(".fc-timegrid-body, .fc-daygrid-body") && !target.closest(".fc-event");
    if (!onEmptySlot) {
      dblClickAtRef.current = 0;
      return;
    }
    dblClickAtRef.current = Date.now();
    tryOpenCreateFromDoubleClick();
  };

  // Keyboard grid navigation (WAI-ARIA "grid" pattern): click a cell (or Tab) to focus the calendar,
  // Arrow keys move a highlighted 30-min slot (Up/Down = time, Left/Right = day), Enter books there.
  // All arithmetic stays in the salon timezone via TZDate so the highlighted/booked time is correct.
  const kbCursorRef = useRef<Date | null>(null);
  const [bhStartH, bhStartM] = businessHoursStart.split(":").map(Number);
  const [bhEndH, bhEndM] = businessHoursEnd.split(":").map(Number);
  const handleCalendarKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canCreate) return;
    // Only when the wrapper itself is focused — not a toolbar button or event inside it.
    if (e.target !== e.currentTarget) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(e.key)) return;
    const api = calendarApi();
    if (!api) return;
    e.preventDefault();
    const wrapper = e.currentTarget;

    // Cursor is a TZDate in the salon timezone — its getHours/setHours are salon wall-clock.
    let c: TZDate;
    if (kbCursorRef.current) {
      c = new TZDate(kbCursorRef.current.getTime(), timezone);
    } else {
      c = new TZDate(Date.now(), timezone);
      c.setHours(bhStartH, bhStartM, 0, 0);
    }

    if (e.key === "Enter" || e.key === " ") {
      const startTime = formatInTz(c, "yyyy-MM-dd'T'HH:mm:ssXXX", timezone);
      router.push(`/dashboard/appointments/new?startTime=${encodeURIComponent(startTime)}`);
      return;
    }
    if (e.key === "ArrowDown") c = addMinutes(c, 30);
    else if (e.key === "ArrowUp") c = addMinutes(c, -30);
    else if (e.key === "ArrowRight") c = addDays(c, 1);
    else if (e.key === "ArrowLeft") c = addDays(c, -1);

    // Clamp the time to business hours [start, end − 30min].
    const startMins = bhStartH * 60 + bhStartM;
    const lastMins = bhEndH * 60 + bhEndM - 30;
    const mins = c.getHours() * 60 + c.getMinutes();
    if (mins < startMins) c.setHours(bhStartH, bhStartM, 0, 0);
    else if (mins > lastMins) c.setHours(Math.floor(lastMins / 60), lastMins % 60, 0, 0);

    // Clamp the day to the currently visible range.
    if (c.getTime() < api.view.activeStart.getTime()) {
      c = new TZDate(api.view.activeStart.getTime(), timezone);
      c.setHours(bhStartH, bhStartM, 0, 0);
    } else if (c.getTime() >= api.view.activeEnd.getTime()) {
      c = new TZDate(api.view.activeEnd.getTime() - 24 * 60 * 60 * 1000, timezone);
      c.setHours(bhStartH, bhStartM, 0, 0);
    }

    kbCursorRef.current = new Date(c.getTime());
    api.select(c, addMinutes(c, 30));
    api.scrollToTime({ hours: c.getHours(), minutes: c.getMinutes() });
    // FullCalendar's select() can move focus; keep it on the wrapper so the next arrow/Enter works.
    wrapper.focus();
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
    <div
      ref={containerRef}
      className="appointment-calendar rounded-lg outline-none"
      tabIndex={canCreate ? 0 : undefined}
      role="application"
      aria-label="Appointment calendar. Press arrow keys to move between time slots, Enter to book an appointment."
      onKeyDown={handleCalendarKeyDown}
      onDoubleClick={handleCalendarDoubleClick}
    >
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

        /* The grey selection highlight must never intercept clicks — otherwise the second click of a
           double-click lands on the highlight overlay (a different target than the first), so the
           browser doesn't fire a native dblclick and "double-click to create" intermittently fails. */
        .appointment-calendar .fc-highlight {
          pointer-events: none;
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

        /* "+N more" link — render as a distinct pill so it doesn't look like part of the
           appointment underneath it. */
        .appointment-calendar .fc-timegrid-more-link,
        .appointment-calendar .fc-daygrid-more-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: hsl(var(--background));
          color: hsl(var(--primary));
          border: 1px solid hsl(var(--primary) / 0.35);
          border-radius: 9999px;
          padding: 0 7px;
          min-width: 1.4rem;
          height: 1.15rem;
          font-size: 0.7rem;
          font-weight: 700;
          line-height: 1;
          /* A white "halo" ring separates the pill from the card underneath, so even sitting flush
             in FullCalendar's native top-right corner its full border reads as distinct instead of
             merging into the card border / gridline. (z-index alone can't do this — the borders are
             at the same pixels, so it's a separation problem, not a stacking one.) */
          box-shadow: 0 0 0 2px hsl(var(--background)), 0 1px 2px rgba(0, 0, 0, 0.12);
          /* Keep FullCalendar's own absolute positioning (overriding it would pull the link into
             normal flow and inflate the event height). z-index keeps the pill on top. */
          z-index: 20;
        }
        .appointment-calendar .fc-timegrid-more-link:hover,
        .appointment-calendar .fc-daygrid-more-link:hover {
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
          border-color: hsl(var(--primary));
        }

        /* "+N more" popover — on-brand card instead of FullCalendar's default box. */
        .fc-popover {
          border-radius: 12px !important;
          border: 1px solid hsl(var(--border)) !important;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18) !important;
          overflow: hidden;
          z-index: 45 !important;
        }
        .fc-popover .fc-popover-header {
          background: hsl(var(--muted));
          color: hsl(var(--foreground));
          padding: 8px 12px;
          font-weight: 600;
          font-size: 0.8rem;
        }
        .fc-popover .fc-popover-close {
          color: hsl(var(--muted-foreground));
          opacity: 1;
        }
        .fc-popover .fc-popover-body {
          background: hsl(var(--background));
          padding: 8px;
          max-height: 300px;
          overflow-y: auto;
          min-width: 200px;
        }
        .fc-popover .fc-event {
          margin-bottom: 4px;
          padding: 4px 6px;
        }
        .fc-popover .fc-event:last-child {
          margin-bottom: 0;
        }
      `}</style>

      {/* Toolbar: staff filter (left) · ‹ title › (center of the card) · today + views (right).
          A 3-column grid centers the date on the card itself, not between the side controls. */}
      <div className="mb-4 flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:items-center">
        {/* Left: staff filter */}
        <div className="flex items-center gap-2 sm:justify-self-start">
          {staff.length > 0 && (
            <>
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
            </>
          )}
        </div>

        {/* Center: date flanked by prev/next so the arrows read as "move the date". */}
        <div className="order-first flex items-center justify-center gap-2 sm:order-none sm:justify-self-center">
          <Button size="icon" className="h-8 w-8" onClick={() => calendarApi()?.prev()} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9.5rem] text-center text-lg font-semibold">{viewTitle}</span>
          <Button size="icon" className="h-8 w-8" onClick={() => calendarApi()?.next()} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: today + view switcher */}
        <div className="flex items-center gap-3 sm:justify-self-end">
          <Button variant="secondary" onClick={() => calendarApi()?.today()}>
            today
          </Button>
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
          // Longer appointments have vertical room, so break the time onto its own line and
          // give each service its own line; short events stay compact on a single wrapped line.
          const durationMin =
            (new Date(apt.endTime).getTime() - new Date(apt.startTime).getTime()) / 60000;
          const expanded = durationMin >= 45;
          return (
            <div className="h-full overflow-hidden leading-tight px-0.5">
              <div className="truncate font-semibold">{recurring}{name}{walkIn}</div>
              {expanded ? (
                <>
                  <div className="truncate text-[0.7rem] opacity-90">{arg.timeText}</div>
                  {apt.services.map((s, i) => (
                    <div key={i} className="truncate text-[0.7rem] opacity-90">
                      {s.service.name}
                    </div>
                  ))}
                </>
              ) : (
                <div className="break-words text-[0.7rem] opacity-90">
                  {arg.timeText}
                  {apt.services.length > 0
                    ? ` · ${apt.services.map((s) => s.service.name).join(", ")}`
                    : ""}
                </div>
              )}
            </div>
          );
        }}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        selectable={false}
        dateClick={handleDateClick}
        datesSet={handleDatesSet}
        slotMinTime={businessHoursStart}
        slotMaxTime={businessHoursEnd}
        slotDuration="00:30:00"
        allDaySlot={false}
        nowIndicator={true}
        height="auto"
        eventDisplay="block"
        // Until per-staff lanes exist, all providers share one column, so overlapping appointments
        // would crumble. Show ONE appointment per slot and collapse the rest into a native
        // "+N more" link → clicking it opens a popover of all appointments at that time, and
        // clicking any of them fires eventClick → the appointment details drawer.
        eventMaxStack={1}
        dayMaxEvents={3}
        weekends={true}
      />

      {/* Status color legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-3.5 w-6 rounded-sm border-l-4 ${statusColors[status].bg} ${statusColors[status].border}`}
            />
            <span>{STATUS_LABELS[status]}</span>
          </div>
        ))}
      </div>

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
          currencyCode={currencyCode}
        />
      )}
    </div>
  );
}
