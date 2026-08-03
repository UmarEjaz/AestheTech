"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
import type { AppointmentListItem } from "@/lib/actions/appointment";
import {
  STATUS_COLORS,
  DRAGGABLE_STATUSES,
  appointmentSegments,
  type AppointmentSegment,
} from "./appointment-visuals";

const SLOT_MIN = 30; // one row = 30 minutes (matches the FullCalendar views)
const ROW_H = 48; // px per 30-min row
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
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
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
}: StaffLaneGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Lane rects captured at drag start (positions are stable during a drag — no auto-scroll).
  const dragRectsRef = useRef<{ dayKey: string; staffId: string; rect: DOMRect }[]>([]);
  const didDragRef = useRef(false); // distinguishes a drag from a plain click
  const [drag, setDrag] = useState<{
    apptId: string;
    durationMin: number;
    origin: { dayKey: string; staffId: string; slotIndex: number };
    target: { dayKey: string; staffId: string; slotIndex: number } | null;
  } | null>(null);
  // Keyboard cursor: which (column, slot) is highlighted for arrow-key navigation + Enter-to-book.
  const [cursor, setCursor] = useState<{ col: number; slot: number } | null>(null);
  // Re-render once a minute so the "now" line and today highlight keep tracking real time.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Offset-aware ISO (salon tz) for a (day, slot) cell — used for booking and drag-drop.
  const slotStart = (dayKey: string, slotIndex: number) => {
    const abs = startMin + slotIndex * SLOT_MIN;
    const [y, m, d] = dayKey.split("-").map(Number);
    const slot = new TZDate(y, m - 1, d, Math.floor(abs / 60), abs % 60, timezone);
    return formatInTz(slot, "yyyy-MM-dd'T'HH:mm:ssXXX", timezone);
  };
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
    dragRectsRef.current = gridRef.current
      ? Array.from(gridRef.current.querySelectorAll<HTMLElement>("[data-lane]")).map((lane) => ({
          dayKey: lane.dataset.dayKey!,
          staffId: lane.dataset.staffId!,
          rect: lane.getBoundingClientRect(),
        }))
      : [];
    const durationMin = seg.appointment.services.reduce((s, x) => s + x.duration, 0) || SLOT_MIN;
    // Remember where this block started so a drop back on the same spot is a no-op (see endDrag).
    const origin = {
      dayKey: formatInTz(seg.start, "yyyy-MM-dd", timezone),
      staffId: seg.staffId,
      slotIndex: Math.round((minutesOfDay(seg.start) - startMin) / SLOT_MIN),
    };
    setDrag({ apptId: seg.appointment.id, durationMin, origin, target: null });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const hit = dragRectsRef.current.find(
      (r) => e.clientX >= r.rect.left && e.clientX <= r.rect.right
    );
    if (!hit) return;
    didDragRef.current = true;
    const slotIndex = Math.max(
      0,
      Math.min(numSlots - 1, Math.floor((e.clientY - hit.rect.top) / ROW_H))
    );
    setDrag((d) => (d ? { ...d, target: { dayKey: hit.dayKey, staffId: hit.staffId, slotIndex } } : d));
  };
  const endDrag = () => {
    const d = drag;
    setDrag(null);
    if (!d || !d.target || !onReschedule) return;
    const t = d.target;
    // Dropped back on the same lane + slot → nothing changed, so skip the server round-trip
    // (which would otherwise run a transaction, write an audit entry, and bust the cache).
    if (t.dayKey === d.origin.dayKey && t.staffId === d.origin.staffId && t.slotIndex === d.origin.slotIndex) {
      return;
    }
    onReschedule(d.apptId, t.staffId, slotStart(t.dayKey, t.slotIndex));
  };
  // Pointer cancelled (touch interruption, context menu, gesture takeover) — pointerup never fires,
  // so just clear the drag visuals. Do NOT reschedule: the drag never completed, and the appointment
  // was never actually moved (only the faded block + drop preview were shown).
  const cancelDrag = () => setDrag(null);

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
    <div className="relative">
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
        aria-label="Staff schedule. Use arrow keys to move between time slots and Enter to book."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => setCursor((c) => c ?? { col: 0, slot: 0 })}
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
                    {formatInTz(label, "EEE, MMM d", timezone)}
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
                className={`absolute right-1 text-[0.7rem] text-muted-foreground ${
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
                      top: drag.target.slotIndex * ROW_H,
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

                {/* Appointment segment blocks */}
                {segs.map((seg) => {
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
                    <button
                      key={`${seg.appointment.id}-${seg.serviceIndex}`}
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
                        {formatInTz(seg.start, "h:mm a", timezone)}
                        {span === "day" ? ` · ${seg.serviceName}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
