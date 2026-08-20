"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2 } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { DateClickArg } from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { TZDate } from "@date-fns/tz";
import { addMinutes, addDays } from "date-fns";
import { formatInTz, formatTimeRangeInTz } from "@/lib/utils/timezone";
import { EventClickArg, DatesSetArg, EventDropArg } from "@fullcalendar/core";
import { AppointmentListItem, getAppointmentsForCalendar, rescheduleAppointment } from "@/lib/actions/appointment";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppointmentDetailModal } from "./appointment-detail-modal";
import { StaffLaneGrid } from "./staff-lane-grid";
import { CalendarEmptyState } from "./calendar-empty-state";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  DRAGGABLE_STATUSES,
} from "./appointment-visuals";

// Time span, shared by both view types. For the normal calendar each span maps to a FullCalendar
// view; the Staff (lane) view uses only week/day (month has no lane form).
// Order: day → week → month. Month is last so hiding it in the Staff view (lanes have no month)
// only trims the END of the left-aligned group — no layout shift for the other controls.
const SPANS = [
  { key: "day", label: "day", fcView: "timeGridDay" },
  { key: "week", label: "week", fcView: "timeGridWeek" },
  { key: "month", label: "month", fcView: "dayGridMonth" },
] as const;
type SpanKey = (typeof SPANS)[number]["key"];

// Non-interactive checked indicator for the staff-filter rows (the row button owns the interaction;
// its state is exposed via aria-pressed, so this is purely visual and hidden from assistive tech).
function StaffCheckIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
      }`}
    >
      {checked && <Check className="h-3 w-3" />}
    </span>
  );
}

// Validate the view preference restored from localStorage (external/user-writable data). Unknown
// values fall back to the calendar/week defaults.
const viewPrefSchema = z.object({
  viewType: z.enum(["calendar", "staff"]).catch("calendar"),
  span: z.enum(SPANS.map((s) => s.key) as [SpanKey, ...SpanKey[]]).catch("week"),
});

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
  // Which providers to show. Empty = all staff. (Multi-select: view several providers at once.)
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  // Controlled so the dropdown stays open while toggling several staff (closes on outside click).
  const [staffFilterOpen, setStaffFilterOpen] = useState(false);
  // Driven by datesSet so our custom toolbar stays in sync with the calendar.
  const [viewTitle, setViewTitle] = useState("");
  const [viewType, setViewType] = useState<"calendar" | "staff">("calendar");
  const [span, setSpan] = useState<SpanKey>("week");

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

  // ── Per-staff lane view (custom-rendered, not a FullCalendar view) ──────────────
  const isLaneView = viewType === "staff";
  // FullCalendar is only CSS-hidden (not unmounted) while in Staff view, so it can return mis-sized.
  // Nudge it to recalculate whenever we switch back to the Calendar view.
  useEffect(() => {
    if (!isLaneView) calendarApi()?.updateSize();
    // calendarApi reads a ref; only the view toggle should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLaneView]);
  // Staff view supports only day/week spans (month has no lane form).
  const laneSpan: "day" | "week" = span === "week" ? "week" : "day";
  const [laneDate, setLaneDate] = useState<Date>(() => new Date());
  const [laneAppointments, setLaneAppointments] = useState<AppointmentListItem[]>([]);
  const [laneRefreshKey, setLaneRefreshKey] = useState(0);
  const [laneLoading, setLaneLoading] = useState(false);
  const laneSeqRef = useRef(0);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // The Sunday–Saturday salon-tz week containing laneDate (used for week span fetch + title).
  const laneWeek = (() => {
    const anchor = new TZDate(laneDate.getTime(), timezone);
    const start = new TZDate(addDays(anchor, -anchor.getDay()).getTime(), timezone);
    start.setHours(0, 0, 0, 0);
    const end = new TZDate(addDays(start, 6).getTime(), timezone);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  })();

  const laneTitle = laneSpan === "week"
    ? `${formatInTz(laneWeek.start, "MMM d", timezone)} – ${formatInTz(laneWeek.end, "MMM d, yyyy", timezone)}`
    : formatInTz(laneDate, "EEE, MMM d, yyyy", timezone);
  const laneStep = laneSpan === "week" ? 7 : 1;
  // Step laneDate by whole SALON-timezone days. Browser-local addDays could repeat or skip a day
  // across a salon daylight-saving transition, since the grid derives its day keys in the salon tz.
  const stepLaneDate = (days: number) =>
    setLaneDate((d) => {
      const z = new TZDate(d.getTime(), timezone);
      // Normalize to midday in the salon tz before stepping so a DST changeover can't skip/repeat a
      // day (matches how StaffLaneGrid derives its dayKeys).
      const t = new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 12, 0, 0, 0, timezone);
      t.setDate(t.getDate() + days);
      return new Date(t.getTime());
    });

  // Fetch the lane view's appointments (one day, or the whole week) — kept in its own state so
  // switching between the FullCalendar views and the lane view never clobbers the other's data.
  useEffect(() => {
    if (!isLaneView) return;
    let rangeStart: Date;
    let rangeEnd: Date;
    if (laneSpan === "week") {
      rangeStart = new Date(laneWeek.start.getTime());
      rangeEnd = new Date(laneWeek.end.getTime());
    } else {
      const dayStart = new TZDate(laneDate.getTime(), timezone);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new TZDate(laneDate.getTime(), timezone);
      dayEnd.setHours(23, 59, 59, 999);
      rangeStart = new Date(dayStart.getTime());
      rangeEnd = new Date(dayEnd.getTime());
    }
    const seq = ++laneSeqRef.current;
    setLaneLoading(true);
    // Only fetch the selected providers' appointments (empty = all) so the payload matches the lanes
    // actually shown when the staff filter narrows the view.
    getAppointmentsForCalendar({
      startDate: rangeStart,
      endDate: rangeEnd,
      staffIds: selectedStaffIds,
    })
      .then((result) => {
        if (seq !== laneSeqRef.current) return;
        setLaneLoading(false);
        if (result.success) setLaneAppointments(result.data);
        else toast.error(result.error || "Couldn't load appointments for the lane view.");
      })
      .catch(() => {
        // Transport / server-action rejection (not a handled ActionResult) — never leave the
        // spinner stuck, and tell the user something went wrong.
        if (seq !== laneSeqRef.current) return;
        setLaneLoading(false);
        toast.error("Couldn't load appointments for the lane view.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLaneView, span, laneDate, timezone, laneRefreshKey, selectedStaffIds]);

  // Remember the chosen view type + span across refreshes (a reload shouldn't snap back to the
  // Calendar/Week default). Restore on mount and sync FullCalendar to the saved span.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("apptViewPref");
      if (!raw) {
        // First visit on a phone: a 7-column Week grid is too cramped to tap accurately, so start on
        // Day. (A saved preference, if any, always wins — handled below.)
        const smallScreen =
          typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
        if (smallScreen) {
          setSpan("day");
          calendarApi()?.changeView(SPANS.find((s) => s.key === "day")!.fcView);
        }
        return;
      }
      // localStorage is external/user-writable, so validate through a Zod schema (unknown values
      // fall back to calendar/week).
      const parsed = viewPrefSchema.safeParse(JSON.parse(raw));
      const viewType = parsed.success ? parsed.data.viewType : "calendar";
      let span: SpanKey = parsed.success ? parsed.data.span : "week";
      // Month is hidden in Staff view, so a restored "staff + month" would leave no span selected —
      // clamp it to "day" (matches the view-toggle click handler).
      if (viewType === "staff" && span === "month") span = "day";
      setSpan(span);
      if (viewType === "staff") setViewType("staff");
      else calendarApi()?.changeView(SPANS.find((s) => s.key === span)!.fcView);
    } catch {
      /* ignore malformed / unavailable storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Skip the first run: on mount the restore effect above sets state, but this effect fires with the
  // still-default values first — writing them would clobber the saved preference before restore lands.
  const skipFirstPersist = useRef(true);
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    try {
      localStorage.setItem("apptViewPref", JSON.stringify({ viewType, span }));
    } catch {
      /* ignore unavailable storage */
    }
  }, [viewType, span]);

  const openAppointment = (id: string) => {
    setSelectedAppointmentId(id);
    setIsModalOpen(true);
  };
  const bookInLane = (staffId: string, startISO: string) => {
    router.push(
      `/dashboard/appointments/new?startTime=${encodeURIComponent(startISO)}&staffId=${staffId}`
    );
  };
  // Shared by the "Today" toolbar button and the empty-state card's "Jump to today".
  const goToToday = () => {
    if (isLaneView) setLaneDate(new Date());
    else calendarApi()?.today();
  };
  const goBookNew = () => router.push("/dashboard/appointments/new");
  // Whether the visible period already includes today — if so, the empty state hides "Jump to today".
  const viewingToday = (() => {
    const now = Date.now();
    if (isLaneView) {
      if (laneSpan === "week") return now >= laneWeek.start.getTime() && now <= laneWeek.end.getTime();
      return (
        formatInTz(laneDate, "yyyy-MM-dd", timezone) ===
        formatInTz(new Date(), "yyyy-MM-dd", timezone)
      );
    }
    return currentViewDates
      ? now >= currentViewDates.start.getTime() && now < currentViewDates.end.getTime()
      : false;
  })();
  // Refresh appointments (called when modal makes changes). Declared before the drag/undo handlers
  // below so they can call it without reading a not-yet-initialized const.
  const refreshAppointments = useCallback(async () => {
    if (!currentViewDates) return;

    const seq = ++fetchSeqRef.current;
    setCalendarLoading(true);
    try {
      const result = await getAppointmentsForCalendar({
        startDate: currentViewDates.start,
        endDate: currentViewDates.end,
        staffIds: selectedStaffIds,
      });
      if (seq !== fetchSeqRef.current) return; // a newer fetch superseded this one
      if (result.success) {
        setAppointments(result.data);
      } else {
        toast.error(result.error || "Couldn't refresh the calendar.");
      }
    } catch {
      if (seq !== fetchSeqRef.current) return;
      toast.error("Couldn't refresh the calendar.");
    } finally {
      if (seq === fetchSeqRef.current) setCalendarLoading(false);
    }
  }, [currentViewDates, selectedStaffIds]);

  // Undo a reschedule back to its previous slot. If it fails, re-offer a one-click "Retry" so a
  // transient error doesn't strand the appointment at the dragged-to spot with no easy way back.
  const attemptUndo = async (apptId: string, prevStart: Date, prevStaffId: string) => {
    const retryAction = {
      label: "Retry",
      onClick: () => attemptUndo(apptId, prevStart, prevStaffId),
    };
    try {
      const r = await rescheduleAppointment(apptId, { startTime: prevStart, staffId: prevStaffId });
      if (!r.success) {
        toast.error(r.error || "Couldn't undo the reschedule.", { action: retryAction });
      }
    } catch {
      toast.error("Couldn't undo the reschedule.", { action: retryAction });
    } finally {
      // Refresh the FullCalendar copy too (not just the lanes) so neither view goes stale.
      await refreshAppointments();
      setLaneRefreshKey((k) => k + 1);
    }
  };

  // Drag-drop in a lane: reschedule to the drop time and (if the lane changed) reassign the primary
  // provider. rescheduleAppointment conflict-checks + is serializable; on any failure we refetch so
  // the block snaps back to the truth.
  const rescheduleInLane = async (apptId: string, staffId: string, startISO: string) => {
    // Remember where it was so we can offer an Undo.
    const before = [...laneAppointments, ...appointments].find((a) => a.id === apptId);
    const prevStart = before ? new Date(before.startTime) : null;
    const prevStaffId = before?.services[0]?.staff.id;
    try {
      const result = await rescheduleAppointment(apptId, {
        startTime: new Date(startISO),
        staffId,
      });
      if (result.success) {
        const a = result.data;
        const name = `${a.client.firstName}${a.client.lastName ? ` ${a.client.lastName}` : ""}`;
        const date = formatInTz(a.startTime, "MMM d", timezone);
        // Keep the time range on one line so it never breaks mid-range.
        const time = `${formatInTz(a.startTime, "h:mm", timezone)}–${formatInTz(a.endTime, "h:mm a", timezone)}`;
        toast.success(
          <span>
            {name} rescheduled to {date}, <span className="whitespace-nowrap">{time}</span>
          </span>,
          {
          action:
            prevStart && prevStaffId
              ? {
                  label: "Undo",
                  onClick: () => attemptUndo(apptId, prevStart, prevStaffId),
                }
              : undefined,
        });
      } else toast.error(result.error || "Couldn't reschedule this appointment.");
    } catch {
      // Transport / server-action rejection — show an error; the finally refetch snaps the block back.
      toast.error("Couldn't reschedule this appointment.");
    } finally {
      // Refresh the FullCalendar copy too (not just the lanes) so neither view goes stale.
      await refreshAppointments();
      setLaneRefreshKey((k) => k + 1);
    }
  };

  // Search both view sources, but the ACTIVE view's data first — otherwise the drawer can show a
  // stale copy (e.g. after a lane reschedule the FullCalendar `appointments` still holds the old
  // time, so searching it first would show the pre-reschedule schedule).
  const selectedAppointment =
    (isLaneView
      ? [...laneAppointments, ...appointments]
      : [...appointments, ...laneAppointments]
    ).find((apt) => apt.id === selectedAppointmentId) ?? null;

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
        STATUS_COLORS[apt.status].bg,
        STATUS_COLORS[apt.status].text,
        "border-l-4",
        STATUS_COLORS[apt.status].border,
        isRecurring ? "fc-event-recurring" : "",
      ].filter(Boolean),
    };
  });

  // Handle date range change
  const handleDatesSet = useCallback(
    async (arg: DatesSetArg) => {
      setCurrentViewDates({ start: arg.start, end: arg.end });
      setViewTitle(arg.view.title);

      const seq = ++fetchSeqRef.current;
      setCalendarLoading(true);
      try {
        const result = await getAppointmentsForCalendar({
          startDate: arg.start,
          endDate: arg.end,
          staffIds: selectedStaffIds,
        });
        if (seq !== fetchSeqRef.current) return; // a newer fetch superseded this one
        if (result.success) {
          setAppointments(result.data);
        } else {
          toast.error(result.error || "Couldn't refresh the calendar.");
        }
      } catch {
        // Transport / server-action rejection — warn (the spinner is cleared in finally).
        if (seq !== fetchSeqRef.current) return;
        toast.error("Couldn't refresh the calendar.");
      } finally {
        // Clear the spinner once, only if this fetch is still the current one.
        if (seq === fetchSeqRef.current) setCalendarLoading(false);
      }
    },
    [selectedStaffIds]
  );

  // The staff selection whose data is actually on screen (empty = all). On a failed load we roll back
  // to THIS — not to whatever `selectedStaffIds` was captured at call time, which can be stale under
  // rapid toggles. Kept in a ref so the callback doesn't need to re-create when the selection changes.
  const lastConfirmedStaffIdsRef = useRef<string[]>([]);

  // Apply a new staff selection (empty = all) and immediately refetch for the current view range.
  const applyStaffSelection = useCallback(
    async (nextIds: string[]) => {
      setSelectedStaffIds(nextIds);
      if (!currentViewDates) {
        // No view range yet (the calendar's first datesSet will fetch with this selection), so there
        // is no on-screen data to contradict — treat the new selection as the confirmed one.
        lastConfirmedStaffIdsRef.current = nextIds;
        return;
      }
      const seq = ++fetchSeqRef.current;
      setCalendarLoading(true);
      try {
        const result = await getAppointmentsForCalendar({
          startDate: currentViewDates.start,
          endDate: currentViewDates.end,
          staffIds: nextIds,
        });
        if (seq !== fetchSeqRef.current) return; // a newer fetch superseded this one
        if (result.success) {
          setAppointments(result.data);
          lastConfirmedStaffIdsRef.current = nextIds; // this selection now matches the shown data
        } else {
          // Revert to the selection whose data is still on screen so the dropdown matches it.
          setSelectedStaffIds(lastConfirmedStaffIdsRef.current);
          toast.error(result.error || "Couldn't load appointments for that staff filter.");
        }
      } catch {
        if (seq !== fetchSeqRef.current) return;
        setSelectedStaffIds(lastConfirmedStaffIdsRef.current);
        toast.error("Couldn't load appointments for that staff filter.");
      } finally {
        if (seq === fetchSeqRef.current) setCalendarLoading(false);
      }
    },
    [currentViewDates]
  );
  const toggleStaff = (id: string) =>
    applyStaffSelection(
      selectedStaffIds.includes(id)
        ? selectedStaffIds.filter((s) => s !== id)
        : [...selectedStaffIds, id]
    );
  const staffFilterLabel =
    selectedStaffIds.length === 0
      ? "All staff"
      : selectedStaffIds.length === 1
        ? (() => {
            const m = staff.find((s) => s.id === selectedStaffIds[0]);
            return m ? `${m.firstName} ${m.lastName}` : "1 selected";
          })()
        : `${selectedStaffIds.length} staff`;

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
    // event, the "+N more" overflow link (which lives inside the grid body but isn't an event), the
    // popover it opens, a day header, the toolbar, or the legend must NOT stamp — otherwise its
    // stamp could pair with a later single slot click and open the create screen on one click.
    const target = e.target as HTMLElement;
    const onEmptySlot =
      target.closest(".fc-timegrid-body, .fc-daygrid-body") &&
      !target.closest(
        ".fc-event, .fc-timegrid-more-link, .fc-daygrid-more-link, .fc-popover, .fc-more-popover"
      );
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

  // Refresh BOTH view sources after a modal mutation, so whichever view is active shows fresh data.
  const handleDataChange = useCallback(async () => {
    await refreshAppointments();
    setLaneRefreshKey((k) => k + 1);
  }, [refreshAppointments]);

  return (
    <div
      ref={containerRef}
      className="appointment-calendar rounded-lg outline-none"
      tabIndex={canCreate ? 0 : undefined}
      role="application"
      aria-label="Appointment calendar. Press arrow keys to move between time slots, Enter to book an appointment."
      onKeyDown={handleCalendarKeyDown}
      onDoubleClick={handleCalendarDoubleClick}
      // This tall role=application container is focusable; a plain click focuses it and the browser
      // scrolls it into view, shifting the page mid-double-click (second click lands on the wrong
      // slot). Pre-focus without scrolling so the browser's default scroll-on-focus is a no-op.
      onMouseDown={(e) => {
        if (canCreate) e.currentTarget.focus({ preventScroll: true });
      }}
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

        .appointment-calendar .fc-daygrid-day-number {
          color: hsl(var(--foreground));
        }

        /* Time rail: light + small (matches the Staff view) so it reads as a ruler, not content. */
        .appointment-calendar .fc-timegrid-slot-label-cushion {
          color: hsl(var(--muted-foreground));
          font-size: 0.75rem;
        }

        .appointment-calendar .fc-event {
          cursor: pointer;
          padding: 2px 4px;
          font-size: 0.75rem;
          border-radius: 4px;
          /* Match the Staff lanes: keep only the colored left accent bar (drop FullCalendar's
             default full 1px border) plus a subtle shadow. Tints come from STATUS_COLORS on both. */
          border-width: 0;
          border-left-width: 4px;
          box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.06);
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

        /* Full-width appointments: FullCalendar reserves a right margin on the events container for a
           possible "+N more" link, leaving a gap even for a single event. Remove it so events fill
           the column; when appointments DO overlap, eventMaxStack still shows one + the "+N" pill,
           which now overlays the top-right corner (z-index above the event). */
        .appointment-calendar .fc-timegrid-col-events {
          margin-inline-end: 0 !important;
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

      {/* Toolbar: view toggles (left) · ‹ date › (center) · staff filter + Today (right).
          A 3-column grid centers the date on the card itself, not between the side controls. */}
      <div className="mb-4 flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:items-center">
        {/* Left: view type + span. Calendar|Staff stays at the far left, so hiding Month in Staff
            only trims the right end of this group — nothing else moves. */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-self-start">
          {/* View TYPE: normal calendar vs per-staff lanes */}
          <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="View type">
            {(["calendar", "staff"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={viewType === t}
                onClick={() => {
                  if (t === "calendar") {
                    // Restore the FullCalendar view for the current span, and carry the Staff date
                    // over so the calendar stays on the date the user was looking at.
                    const fc = SPANS.find((s) => s.key === span)?.fcView ?? "timeGridWeek";
                    const api = calendarApi();
                    api?.changeView(fc);
                    api?.gotoDate(laneDate);
                  } else {
                    // Entering Staff: start from the date the calendar is currently showing.
                    const current = calendarApi()?.getDate();
                    if (current) setLaneDate(current);
                    // Lanes have no month form — fall back to day.
                    if (span === "month") setSpan("day");
                  }
                  setViewType(t);
                }}
                className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                  viewType === t ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* SPAN: shared by both. Month (last) is hidden in Staff view — trims from the end only. */}
          <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Time span">
            {SPANS.filter((s) => !(isLaneView && s.key === "month")).map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={span === s.key}
                onClick={() => {
                  setSpan(s.key);
                  if (!isLaneView) calendarApi()?.changeView(s.fcView);
                }}
                className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                  span === s.key ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Center: date flanked by prev/next so the arrows read as "move the date". */}
        <div className="order-first flex items-center justify-center gap-2 sm:order-none sm:justify-self-center">
          <Button
            size="icon"
            className="h-8 w-8"
            onClick={() => (isLaneView ? stepLaneDate(-laneStep) : calendarApi()?.prev())}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9.5rem] text-center text-lg font-semibold">
            {isLaneView ? laneTitle : viewTitle}
          </span>
          <Button
            size="icon"
            className="h-8 w-8"
            onClick={() => (isLaneView ? stepLaneDate(laneStep) : calendarApi()?.next())}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* Today sits with the date navigation (it's a "jump to today" action). */}
          <Button variant="secondary" className="ml-1" onClick={goToToday}>
            Today
          </Button>
        </div>

        {/* Right: staff filter. In Calendar view it filters events; in Staff view it narrows which
            provider lanes are shown (handy when a salon has many staff). */}
        <div className="flex items-center gap-3 sm:justify-self-end">
          {staff.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="hidden text-sm font-medium text-foreground sm:inline">Staff</span>
              <Popover open={staffFilterOpen} onOpenChange={setStaffFilterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[170px] justify-between font-normal"
                    aria-label="Filter by staff"
                  >
                    <span className="truncate">{staffFilterLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[220px] p-1">
                  {/* Each row is a single toggle button; its checked state is a non-interactive
                      indicator + aria-pressed (a nested Checkbox would be a button inside a button). */}
                  <button
                    type="button"
                    aria-pressed={selectedStaffIds.length === 0}
                    onClick={() => applyStaffSelection([])}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <StaffCheckIndicator checked={selectedStaffIds.length === 0} />
                    All staff
                  </button>
                  <div className="my-1 h-px bg-border" />
                  {staff.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={selectedStaffIds.includes(member.id)}
                      onClick={() => toggleStaff(member.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <StaffCheckIndicator checked={selectedStaffIds.includes(member.id)} />
                      <span className="truncate">
                        {member.firstName} {member.lastName}
                      </span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </div>

      <div className={isLaneView ? "hidden" : "relative"}>
      {!isLaneView && calendarLoading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/40">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {!isLaneView && !calendarLoading && events.length === 0 && (
        <CalendarEmptyState span={span} onBook={goBookNew} onToday={viewingToday ? undefined : goToToday} />
      )}
      <FullCalendar
        ref={calendarRef}
        timeZone={timezone}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
        initialView="timeGridWeek"
        headerToolbar={false}
        views={{
          timeGridWeek: { dayHeaderFormat: { weekday: "short", day: "numeric" } },
          // Day view has one wide column, so a fuller "Friday, Jul 31" header reads well there.
          timeGridDay: { dayHeaderFormat: { weekday: "long", month: "short", day: "numeric" } },
        }}
        eventMinHeight={24}
        // We render our own focusable button inside each event (see eventContent below), so turn OFF
        // FullCalendar's own event interactivity — otherwise, because we pass an eventClick handler,
        // FC also makes the event element focusable (tabindex + role=button), nesting two interactive
        // controls. Mouse clicks still open details (eventClick fires regardless of this flag).
        eventInteractive={false}
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
          // Compact "10–10:30 AM" range (drops :00 on whole hours, shares the meridiem).
          const timeText = formatTimeRangeInTz(apt.startTime, apt.endTime, timezone);
          const serviceNames = apt.services.map((s) => s.service.name).join(", ");
          // This inner button is the ONE focusable control for the event (FC's own interactivity is
          // disabled via eventInteractive={false} above), so keyboard/screen-reader users can open
          // its details (parity with the Staff lanes).
          const openOnKey = (e: ReactKeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openAppointment(apt.id);
            }
          };
          return (
            <div
              className="h-full overflow-hidden leading-tight px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              role="button"
              tabIndex={0}
              aria-label={`${name}${walkIn}, ${timeText}${serviceNames ? `, ${serviceNames}` : ""}, ${STATUS_LABELS[apt.status]}. Press Enter to open.`}
              onKeyDown={openOnKey}
            >
              <div className="truncate font-semibold">{recurring}{name}{walkIn}</div>
              {expanded ? (
                <>
                  <div className="truncate text-[0.7rem] opacity-90">{timeText}</div>
                  {apt.services.map((s, i) => (
                    <div key={i} className="truncate text-[0.7rem] opacity-90">
                      {s.service.name}
                    </div>
                  ))}
                </>
              ) : (
                <div className="break-words text-[0.7rem] opacity-90">
                  {timeText}
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
        // Rows are drawn every 30 min, but a drag snaps to 5-min steps so an appointment can be
        // rescheduled to an off-grid minute (e.g. 9:20) — matching the custom-time booking field.
        snapDuration="00:05:00"
        // Full "9 AM" / "1:30 PM" hour labels on the left rail (FullCalendar's default is "9am").
        slotLabelFormat={{ hour: "numeric", minute: "2-digit", omitZeroMinute: true, meridiem: "lowercase" }}
        slotLabelContent={(arg) => arg.text.replace(/\s*(am|pm)$/i, (_m, mer) => ` ${mer.toUpperCase()}`)}
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
      </div>

      {isLaneView && (
        <StaffLaneGrid
          appointments={laneAppointments}
          staff={selectedStaffIds.length === 0 ? staff : staff.filter((s) => selectedStaffIds.includes(s.id))}
          date={laneDate}
          span={laneSpan}
          businessHoursStart={businessHoursStart}
          businessHoursEnd={businessHoursEnd}
          timezone={timezone}
          canCreate={canCreate}
          canDrag={canUpdate}
          loading={laneLoading}
          onSelectAppointment={openAppointment}
          onBookSlot={bookInLane}
          onReschedule={rescheduleInLane}
          onEmptyBook={goBookNew}
          onEmptyToday={viewingToday ? undefined : goToToday}
        />
      )}

      {/* Status color legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-3.5 w-6 rounded-sm border-l-4 ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].border}`}
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
          onDataChange={handleDataChange}
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
