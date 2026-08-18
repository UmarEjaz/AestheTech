"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { formatInTz, formatTimeRangeInTz } from "@/lib/utils/timezone";
import type { AppointmentListItem } from "@/lib/actions/appointment";
import {
  STATUS_COLORS,
  DRAGGABLE_STATUSES,
  appointmentSegments,
  type AppointmentSegment,
} from "./appointment-visuals";
import { CalendarEmptyState } from "./calendar-empty-state";

const SLOT_MIN = 30; // one row = 30 minutes (matches the FullCalendar views)
// Dragging snaps to this finer step so an appointment can be rescheduled to an off-grid minute
// (e.g. 9:20 for back-to-back bookings), even though rows are still drawn every 30 min.
const SNAP_MIN = 5;
// Pointer must travel this far before a press counts as a drag (not a click) — so tiny finger/mouse
// jitter during a tap still opens the details drawer instead of being swallowed as a drag.
const DRAG_THRESHOLD_PX = 4;
const ROW_H = 52; // px per 30-min row (matches the FullCalendar 3.25rem slot so blocks are the same size)
const MIN_BLOCK_H = 22; // never render a block shorter than this
const GUTTER_PX = 64; // time-gutter width (w-16)

interface StaffLaneGridProps {
  appointments: AppointmentListItem[];
  staff: { id: string; firstName: string; lastName: string }[];
  /** The selected day, as an instant; its salon-timezone calendar day anchors the view. */
  date: Date;
  /** "day" = staff columns for one day. "week" = 7 days, each split into staff columns. */
  span: "day" | "week";
  businessHoursStart: string; // "08:00"
  businessHoursEnd: string; // "20:00"
  timezone: string;
  canCreate?: boolean;
  /** Whether appointments may be dragged to reschedule / reassign provider. */
  canDrag?: boolean;
  /** Show a spinner overlay while the day/week is being (re)fetched. */
  loading?: boolean;
  onSelectAppointment: (id: string) => void;
  onBookSlot?: (staffId: string, startISO: string) => void;
  /** Drag drop: move the appointment to `startISO` and (if the lane changed) reassign to `staffId`. */
  onReschedule?: (apptId: string, staffId: string, startISO: string) => void;
  /** Empty-state card actions. */
  onEmptyBook?: () => void;
  onEmptyToday?: () => void;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Group a lane's segments into overlap clusters (sets of overlapping segments), sorted by start.
// Appointments can only overlap in a lane via cancelled/no-show rows (the DB blocks double-booking
// an active provider), but we handle it generally.
function clusterSegments(segs: AppointmentSegment[]): AppointmentSegment[][] {
  const sorted = [...segs].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()
  );
  const clusters: AppointmentSegment[][] = [];
  let cur: AppointmentSegment[] = [];
  let end = -Infinity;
  for (const s of sorted) {
    if (cur.length > 0 && s.start.getTime() >= end) {
      clusters.push(cur);
      cur = [];
      end = -Infinity;
    }
    cur.push(s);
    end = Math.max(end, s.end.getTime());
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

const isInactive = (s: AppointmentSegment) =>
  s.appointment.status === "CANCELLED" || s.appointment.status === "NO_SHOW";

// The segment shown full-width for a cluster: prefer an active appointment, then the earliest start.
function pickVisible(cluster: AppointmentSegment[]): AppointmentSegment {
  return [...cluster].sort(
    (a, b) => Number(isInactive(a)) - Number(isInactive(b)) || a.start.getTime() - b.start.getTime()
  )[0];
}

export function StaffLaneGrid({
  appointments,
  staff,
  date,
  span,
  businessHoursStart,
  businessHoursEnd,
  timezone,
  canCreate = false,
  canDrag = false,
  loading = false,
  onSelectAppointment,
  onBookSlot,
  onReschedule,
  onEmptyBook,
  onEmptyToday,
}: StaffLaneGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Lane elements captured at drag start; their rects are read LIVE during the drag so a sideways
  // scroll mid-drag can't send the drop to a stale position.
  const dragLanesRef = useRef<{ dayKey: string; staffId: string; el: HTMLElement }[]>([]);
  const didDragRef = useRef(false); // distinguishes a drag from a plain click
  const pressPosRef = useRef<{ x: number; y: number } | null>(null); // where the press started
  const [drag, setDrag] = useState<{
    apptId: string;
    durationMin: number;
    // Pixels between the pointer and the block's top at grab time, so the block follows the cursor
    // from where it was grabbed instead of jumping its top to the pointer.
    grabOffsetPx: number;
    // `min` = minutes past business open, snapped to SNAP_MIN (finer than a 30-min row).
    origin: { dayKey: string; staffId: string; min: number };
    target: { dayKey: string; staffId: string; min: number } | null;
  } | null>(null);
  // Keyboard cursor: which (column, slot) is highlighted for arrow-key navigation + Enter-to-book.
  const [cursor, setCursor] = useState<{ col: number; slot: number } | null>(null);
  // "+N more" overlap popover, positioned relative to the (non-clipping) outer wrapper.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [overlapPopover, setOverlapPopover] = useState<
    { x: number; y: number; segs: AppointmentSegment[] } | null
  >(null);
  const openOverlapPopover = (e: ReactMouseEvent<HTMLElement>, cluster: AppointmentSegment[]) => {
    e.stopPropagation();
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const pr = e.currentTarget.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    setOverlapPopover({ x: pr.left - wr.left, y: pr.bottom - wr.top + 4, segs: cluster });
  };
  useEffect(() => {
    if (!overlapPopover) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOverlapPopover(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlapPopover]);
  // Re-render once a minute so the "now" line and today highlight keep tracking real time.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Keep the keyboard cursor's column visible: in week view a lane can be scrolled off-screen, so
  // nudge only the grid's horizontal scroll (never the page) to bring the active column into view.
  useEffect(() => {
    if (!cursor || !gridRef.current) return;
    const lane = gridRef.current.querySelectorAll<HTMLElement>("[data-lane]")[cursor.col];
    if (!lane) return;
    const grid = gridRef.current;
    const g = grid.getBoundingClientRect();
    const l = lane.getBoundingClientRect();
    if (l.left < g.left) grid.scrollLeft -= g.left - l.left + 8;
    else if (l.right > g.right) grid.scrollLeft += l.right - g.right + 8;
  }, [cursor]);

  const startMin = toMinutes(businessHoursStart);
  const endMin = toMinutes(businessHoursEnd);
  const numSlots = Math.max(1, Math.ceil((endMin - startMin) / SLOT_MIN));
  const bodyHeight = numSlots * ROW_H;
  const lanePx = span === "week" ? 116 : 152; // min lane width; narrower when there are many (week)

  const todayKey = formatInTz(new Date(), "yyyy-MM-dd", timezone);

  // Salon-tz day keys covered by the view: one day, or the Sun–Sat week containing `date`.
  const dayKeys = useMemo(() => {
    const selKey = formatInTz(date, "yyyy-MM-dd", timezone);
    if (span === "day") return [selKey];
    const [y, m, d] = selKey.split("-").map(Number);
    const noon = new TZDate(y, m - 1, d, 12, 0, timezone);
    const dow = noon.getDay(); // 0 = Sunday
    return Array.from({ length: 7 }, (_, i) =>
      formatInTz(addDays(noon, i - dow), "yyyy-MM-dd", timezone)
    );
  }, [date, span, timezone]);

  // Flat column list: (day × staff). For day span that's just the staff.
  const columns = useMemo(
    () =>
      dayKeys.flatMap((dk) =>
        staff.map((s) => ({ key: `${dk}|${s.id}`, dayKey: dk, staff: s }))
      ),
    [dayKeys, staff]
  );

  const minutesOfDay = (d: Date) => {
    const [h, m] = formatInTz(d, "HH:mm", timezone).split(":").map(Number);
    return h * 60 + m;
  };

  // Segments grouped by "dayKey|staffId" so each lane can grab its own in O(1).
  const segsByColumn = useMemo(() => {
    const map = new Map<string, AppointmentSegment[]>();
    for (const appt of appointments) {
      for (const seg of appointmentSegments(appt)) {
        const key = `${formatInTz(seg.start, "yyyy-MM-dd", timezone)}|${seg.staffId}`;
        const list = map.get(key);
        if (list) list.push(seg);
        else map.set(key, [seg]);
      }
    }
    return map;
  }, [appointments, timezone]);

  const nowMin = minutesOfDay(new Date());
  const showNow = nowMin >= startMin && nowMin <= endMin;
  const nowTop = ((nowMin - startMin) / SLOT_MIN) * ROW_H;
  const firstTodayColIndex = columns.findIndex((c) => c.dayKey === todayKey);

  // Text spoken by screen readers as the keyboard cursor moves (silent/invisible to sighted users).
  // Tells them which provider + time is selected, so Enter never books an unknown slot.
  const cursorLabel = (() => {
    if (!cursor) return "";
    const c = columns[cursor.col];
    if (!c) return "";
    const abs = startMin + cursor.slot * SLOT_MIN;
    const [y, m, d] = c.dayKey.split("-").map(Number);
    const cd = new TZDate(y, m - 1, d, Math.floor(abs / 60), abs % 60, timezone);
    return `${c.staff.firstName} ${c.staff.lastName}, ${formatInTz(cd, "EEE MMM d, h:mm a", timezone)}`;
  })();

  const hourLabels = useMemo(() => {
    const [y, m, d] = dayKeys[0].split("-").map(Number);
    const labels: { top: number; text: string }[] = [];
    for (let mm = startMin; mm <= endMin; mm += 60) {
      const h = Math.floor(mm / 60);
      const label = new TZDate(y, m - 1, d, h, 0, timezone);
      labels.push({ top: ((mm - startMin) / SLOT_MIN) * ROW_H, text: formatInTz(label, "h a", timezone) });
    }
    return labels;
  }, [startMin, endMin, dayKeys, timezone]);

  // Offset-aware ISO (salon tz) for a given minutes-past-open on a day.
  const slotStartAtMin = (dayKey: string, minFromOpen: number) => {
    const abs = startMin + minFromOpen;
    const [y, m, d] = dayKey.split("-").map(Number);
    const slot = new TZDate(y, m - 1, d, Math.floor(abs / 60), abs % 60, timezone);
    return formatInTz(slot, "yyyy-MM-dd'T'HH:mm:ssXXX", timezone);
  };
  // Offset-aware ISO (salon tz) for a (day, slot) cell — used for booking a whole 30-min slot.
  const slotStart = (dayKey: string, slotIndex: number) => slotStartAtMin(dayKey, slotIndex * SLOT_MIN);
  const bookSlot = (dayKey: string, staffId: string, slotIndex: number) => {
    if (!canCreate || !onBookSlot) return;
    onBookSlot(staffId, slotStart(dayKey, slotIndex));
  };

  // Only the PRIMARY segment (order 0) drives drag — the backend reschedules the whole appointment
  // from its start and reassigns the primary provider. Non-primary segments follow along.
  const canDragSeg = (seg: AppointmentSegment) =>
    canDrag &&
    !!onReschedule &&
    seg.serviceIndex === 0 &&
    DRAGGABLE_STATUSES.includes(seg.appointment.status);

  const beginDrag = (e: ReactPointerEvent<HTMLButtonElement>, seg: AppointmentSegment) => {
    if (!canDragSeg(seg)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    pressPosRef.current = { x: e.clientX, y: e.clientY };
    dragLanesRef.current = gridRef.current
      ? Array.from(gridRef.current.querySelectorAll<HTMLElement>("[data-lane]")).map((lane) => ({
          dayKey: lane.dataset.dayKey!,
          staffId: lane.dataset.staffId!,
          el: lane,
        }))
      : [];
    const durationMin = seg.appointment.services.reduce((s, x) => s + x.duration, 0) || SLOT_MIN;
    // Distance from the pointer to the block's top, preserved so the block doesn't jump when grabbed
    // below its top edge.
    const grabOffsetPx = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Remember where this block started so a drop back on the same spot is a no-op (see endDrag).
    const originMaxMin = Math.max(0, endMin - startMin - durationMin);
    const origin = {
      dayKey: formatInTz(seg.start, "yyyy-MM-dd", timezone),
      staffId: seg.staffId,
      // Snap + clamp exactly like moveDrag (same lower AND upper bound) so a drop back on the same
      // spot compares equal (no-op), even for an off-grid start (9:22), a before-open start, or a
      // start past the latest valid slot.
      min: Math.max(
        0,
        Math.min(originMaxMin, Math.round((minutesOfDay(seg.start) - startMin) / SNAP_MIN) * SNAP_MIN)
      ),
    };
    setDrag({ apptId: seg.appointment.id, durationMin, grabOffsetPx, origin, target: null });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    // Ignore sub-threshold jitter so a shaky tap still registers as a click (opens the drawer).
    if (!didDragRef.current) {
      const p = pressPosRef.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX) return;
      didDragRef.current = true;
    }
    // Require the pointer to be inside a lane on BOTH axes. Measure each lane LIVE (positions can move
    // if the grid is scrolled mid-drag). Otherwise clear the target, so releasing off the lanes can't
    // reschedule to a stale destination.
    const hit = dragLanesRef.current
      .map((lane) => ({ ...lane, rect: lane.el.getBoundingClientRect() }))
      .find(
        (r) =>
          e.clientX >= r.rect.left &&
          e.clientX <= r.rect.right &&
          e.clientY >= r.rect.top &&
          e.clientY <= r.rect.bottom
      );
    if (!hit) {
      setDrag((d) => (d ? { ...d, target: null } : d));
      return;
    }
    // Pixel offset → minutes past open, snapped to SNAP_MIN. Subtract the grab offset so the block's
    // TOP (not the cursor) lands at the drop point. Clamp so it stays inside business hours
    // (last valid start = close − duration).
    const rawMin = ((e.clientY - hit.rect.top - drag.grabOffsetPx) / ROW_H) * SLOT_MIN;
    const maxMin = Math.max(0, endMin - startMin - drag.durationMin);
    const min = Math.max(0, Math.min(maxMin, Math.round(rawMin / SNAP_MIN) * SNAP_MIN));
    setDrag((d) => (d ? { ...d, target: { dayKey: hit.dayKey, staffId: hit.staffId, min } } : d));
  };
  const endDrag = () => {
    const d = drag;
    setDrag(null);
    if (!d || !d.target || !onReschedule) return;
    const t = d.target;
    // Dropped back on the same lane + slot → nothing changed, so skip the server round-trip
    // (which would otherwise run a transaction, write an audit entry, and bust the cache).
    if (t.dayKey === d.origin.dayKey && t.staffId === d.origin.staffId && t.min === d.origin.min) {
      return;
    }
    onReschedule(d.apptId, t.staffId, slotStartAtMin(t.dayKey, t.min));
  };
  // Pointer cancelled (touch interruption, context menu, gesture takeover) — pointerup never fires,
  // so just clear the drag visuals. Do NOT reschedule: the drag never completed, and the appointment
  // was never actually moved (only the faded block + drop preview were shown).
  const cancelDrag = () => {
    // A cancelled pointer stream fires no click, so clear the click guard here too — otherwise the
    // next click on this block is swallowed and its details drawer won't open.
    didDragRef.current = false;
    setDrag(null);
  };

  // Arrow-key navigation over the slot grid, Enter to book — parity with the FullCalendar views.
  // (Keys from a focused appointment block bubble here too; ignore those so Enter still opens it.)
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(e.key)) return;
    e.preventDefault();
    const cur = cursor ?? { col: 0, slot: 0 };
    if (e.key === "Enter" || e.key === " ") {
      const c = columns[cur.col];
      if (c && canCreate && onBookSlot) onBookSlot(c.staff.id, slotStart(c.dayKey, cur.slot));
      return;
    }
    let { col, slot } = cur;
    if (e.key === "ArrowDown") slot = Math.min(slot + 1, numSlots - 1);
    else if (e.key === "ArrowUp") slot = Math.max(slot - 1, 0);
    else if (e.key === "ArrowRight") col = Math.min(col + 1, columns.length - 1);
    else if (e.key === "ArrowLeft") col = Math.max(col - 1, 0);
    setCursor({ col, slot });
  };

  if (staff.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        No service providers to show lanes for.
      </div>
    );
  }

  // Horizontal-only scroll (many columns). overflow-y hidden so the page owns vertical scroll.
  return (
    <div ref={wrapperRef} className="relative">
      {!loading && appointments.length === 0 && (
        <CalendarEmptyState span={span} onBook={onEmptyBook} onToday={onEmptyToday} />
      )}
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-background/40">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {/* Screen-reader-only live region: announces the selected provider + time as the cursor moves.
          (No role="grid" — this custom grid has no row/cell structure, so that role would mislead
          assistive tech; the live region conveys the active cell instead.) */}
      <div className="sr-only" aria-live="polite" role="status">
        {cursorLabel}
      </div>
      <div
        ref={gridRef}
        // `group` lets the aria-label actually be announced (a plain div's generic role can't carry a
        // name); keyboard/focus/mouse behavior is unchanged.
        role="group"
        aria-label="Staff schedule. Use arrow keys to move between time slots and Enter to book."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => setCursor((c) => c ?? { col: 0, slot: 0 })}
        // Pre-focus without scrolling: a plain click otherwise focuses this tall grid and the browser
        // scrolls it into view, shifting the page mid-double-click. (See appointment-calendar.tsx.)
        onMouseDown={(e) => e.currentTarget.focus({ preventScroll: true })}
        className="overflow-x-auto overflow-y-hidden rounded-lg border outline-none"
      >
      <div className="w-max min-w-full">
        {/* Sticky header — day row (week only) + staff row, kept together */}
        <div className="sticky top-0 z-20 bg-muted">
          {span === "week" && (
            <div className="flex border-b">
              <div className="shrink-0 border-r" style={{ width: GUTTER_PX }} />
              {dayKeys.map((dk) => {
                const [y, mo, d] = dk.split("-").map(Number);
                const label = new TZDate(y, mo - 1, d, 12, 0, timezone);
                const isToday = dk === todayKey;
                return (
                  <div
                    key={dk}
                    className={`border-r px-2 py-1 text-center text-xs font-semibold last:border-r-0 ${
                      isToday ? "text-primary" : "text-foreground"
                    }`}
                    style={{ flex: `${staff.length} 1 0`, minWidth: staff.length * lanePx }}
                  >
                    {formatInTz(label, "d EEE", timezone)}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex border-b">
            <div className="shrink-0 border-r" style={{ width: GUTTER_PX }} />
            {columns.map((c, ci) => {
              const dayBoundary = span === "week" && ci > 0 && columns[ci - 1].dayKey !== c.dayKey;
              return (
                <div
                  key={c.key}
                  className={`border-r px-1 py-2 text-center text-xs font-medium text-foreground last:border-r-0 ${
                    dayBoundary ? "border-l-2 border-l-border" : ""
                  }`}
                  style={{ flex: "1 1 0", minWidth: lanePx }}
                >
                  <span className="block truncate">
                    {c.staff.firstName} {span === "day" ? c.staff.lastName : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Body: time gutter + lanes */}
        <div className="relative flex">
          <div className="relative shrink-0 border-r" style={{ width: GUTTER_PX, height: bodyHeight }}>
            {hourLabels.map((l) => (
              <div
                key={l.top}
                className={`absolute right-1 text-xs text-muted-foreground ${
                  l.top === 0 ? "top-0.5" : "-translate-y-1/2"
                }`}
                style={{ top: l.top === 0 ? undefined : l.top }}
              >
                {l.text}
              </div>
            ))}
          </div>

          {columns.map((c, ci) => {
            const segs = segsByColumn.get(c.key) ?? [];
            const isToday = c.dayKey === todayKey;
            const dayBoundary = span === "week" && ci > 0 && columns[ci - 1].dayKey !== c.dayKey;
            return (
              <div
                key={c.key}
                data-lane
                data-day-key={c.dayKey}
                data-staff-id={c.staff.id}
                className={`relative border-r last:border-r-0 ${
                  dayBoundary ? "border-l-2 border-l-border" : ""
                }`}
                style={{ flex: "1 1 0", minWidth: lanePx, height: bodyHeight }}
              >
                {/* Drop preview while dragging an appointment into this lane */}
                {drag?.target && drag.target.dayKey === c.dayKey && drag.target.staffId === c.staff.id && (
                  <div
                    className="pointer-events-none absolute left-0.5 right-0.5 z-20 rounded border-2 border-dashed border-primary bg-primary/10"
                    style={{
                      top: (drag.target.min / SLOT_MIN) * ROW_H,
                      height: Math.max((drag.durationMin / SLOT_MIN) * ROW_H, MIN_BLOCK_H),
                    }}
                  />
                )}

                {/* Keyboard cursor highlight (arrow-key navigation) */}
                {cursor && cursor.col === ci && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-[15] bg-primary/15 ring-2 ring-inset ring-primary"
                    style={{ top: cursor.slot * ROW_H, height: ROW_H }}
                  />
                )}

                {/* Background slot cells (double-click to book in this lane) */}
                {Array.from({ length: numSlots }).map((_, i) => (
                  <div
                    key={i}
                    className={`border-b border-dashed border-border/60 ${
                      canCreate ? "hover:bg-primary/5" : ""
                    }`}
                    style={{ height: ROW_H }}
                    onDoubleClick={() => bookSlot(c.dayKey, c.staff.id, i)}
                  />
                ))}

                {/* "Now" line — only in today's column(s); a single dot on the first such column.
                    Brand purple, not red (red is the "Cancelled" status color in the legend). */}
                {showNow && isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-primary/70"
                    style={{ top: nowTop }}
                  >
                    {ci === firstTodayColIndex && (
                      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                )}

                {/* One full-width block per overlap cluster (the active/earliest appointment); a
                    "+N" pill opens the rest (cancelled/no-show, etc.) in a popover. */}
                {clusterSegments(segs).map((cluster) => {
                  const seg = pickVisible(cluster);
                  const overlapCount = cluster.length - 1;
                  const segStartMin = minutesOfDay(seg.start);
                  const durationMin = (seg.end.getTime() - seg.start.getTime()) / 60000;
                  const segEndMin = segStartMin + durationMin;
                  // Skip appointments entirely outside business hours; clamp partial ones to the grid.
                  if (segEndMin <= startMin || segStartMin >= endMin) return null;
                  const top = Math.max(0, ((segStartMin - startMin) / SLOT_MIN) * ROW_H);
                  const bottom = Math.min(bodyHeight, ((segEndMin - startMin) / SLOT_MIN) * ROW_H);
                  const height = Math.max(bottom - top, MIN_BLOCK_H);
                  const colors = STATUS_COLORS[seg.appointment.status];
                  const client = seg.appointment.client;
                  const clientName = `${client.firstName}${client.lastName ? ` ${client.lastName}` : ""}`;
                  const draggable = canDragSeg(seg);
                  const isDragging = drag?.apptId === seg.appointment.id;
                  // Cancelled / no-show recede: dimmed and rendered under active appointments.
                  const dimmed =
                    seg.appointment.status === "CANCELLED" || seg.appointment.status === "NO_SHOW";
                  return (
                    <Fragment key={`${seg.appointment.id}-${seg.serviceIndex}`}>
                    <button
                      type="button"
                      onClick={() => {
                        // A drag ends with a pointerup that also fires click — swallow that one.
                        if (didDragRef.current) {
                          didDragRef.current = false;
                          return;
                        }
                        onSelectAppointment(seg.appointment.id);
                      }}
                      onPointerDown={draggable ? (e) => beginDrag(e, seg) : undefined}
                      onPointerMove={draggable ? moveDrag : undefined}
                      onPointerUp={draggable ? endDrag : undefined}
                      onPointerCancel={draggable ? cancelDrag : undefined}
                      aria-label={`${clientName}, ${formatInTz(seg.start, "h:mm a", timezone)}, ${seg.serviceName}, ${seg.appointment.status.toLowerCase().replace("_", " ")}`}
                      className={`absolute left-0.5 right-0.5 overflow-hidden rounded border-l-4 px-1 py-0.5 text-left text-[0.7rem] leading-tight shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${colors.bg} ${colors.border} ${colors.text} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${dimmed ? "z-[4] opacity-60" : "z-[5]"}`}
                      style={{ top, height, opacity: isDragging ? 0.4 : undefined }}
                      title={`${clientName} · ${formatInTz(seg.start, "h:mm a", timezone)} · ${seg.serviceName}`}
                    >
                      <span className="block truncate font-semibold">
                        {seg.appointment.series?.isActive ? "↻ " : ""}
                        {client.isWalkIn ? "↳ " : ""}
                        {clientName}
                      </span>
                      <span className="block truncate opacity-90">
                        {formatTimeRangeInTz(seg.start, seg.end, timezone)}
                        {` · ${seg.serviceName}`}
                      </span>
                    </button>
                    {overlapCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => openOverlapPopover(e, cluster)}
                        aria-label={`${overlapCount} more appointment${overlapCount > 1 ? "s" : ""} at this time`}
                        title={`${overlapCount} more at this time`}
                        className="absolute right-1 z-[7] rounded-full border border-primary/40 bg-background px-1.5 text-[0.65rem] font-bold leading-4 text-primary shadow-sm hover:bg-primary/10"
                        style={{ top: top + 2 }}
                      >
                        +{overlapCount}
                      </button>
                    )}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* "+N more" overlap popover — rendered in the outer wrapper so the grid's overflow can't clip
          it. Lists every appointment in the cluster; clicking one opens the details drawer. */}
      {overlapPopover && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOverlapPopover(null)}
          />
          <div
            className="absolute z-50 max-h-72 min-w-[13rem] max-w-[16rem] overflow-y-auto rounded-lg border bg-background p-1 shadow-lg"
            style={{ left: overlapPopover.x, top: overlapPopover.y }}
          >
            {overlapPopover.segs.map((s) => {
              const colors = STATUS_COLORS[s.appointment.status];
              const cn = `${s.appointment.client.firstName}${s.appointment.client.lastName ? ` ${s.appointment.client.lastName}` : ""}`;
              return (
                <button
                  key={`${s.appointment.id}-${s.serviceIndex}`}
                  type="button"
                  onClick={() => {
                    onSelectAppointment(s.appointment.id);
                    setOverlapPopover(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                >
                  <span className={`h-3 w-1.5 shrink-0 rounded-sm border-l-4 ${colors.bg} ${colors.border}`} />
                  <span className="min-w-0 flex-1 truncate">
                    {cn} · {formatInTz(s.start, "h:mm a", timezone)} · {s.serviceName}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
