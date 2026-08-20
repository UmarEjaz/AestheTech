import { useState, useEffect, useRef } from "react";
import { TZDate } from "@date-fns/tz";
import { validateCustomTime } from "@/lib/actions/appointment";
import { formatInTz } from "@/lib/utils/timezone";

// The salon-local calendar day ("yyyy-MM-dd") encoded by a picked date. Matches how buildInstant
// reads selectedDate (its local Y/M/D fields ARE the salon day), so it lines up with formatInTz of a
// resolved instant.
const localDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Server-checked status of the typed custom time (business hours, past, provider conflict).
// "ok" is required before the booking can go through.
export type CustomTimeCheck = {
  status: "idle" | "checking" | "ok" | "invalid";
  message?: string;
  suggestionHHMM?: string;
  suggestionLabel?: string;
  // Salon-local day ("yyyy-MM-dd") of the suggested slot — may differ from the selected day when the
  // next free slot rolls to a later date.
  suggestionDateISO?: string;
};

type Assignment = { serviceId: string; staffId: string };

interface UseCustomTimeCheckParams {
  /** Service→staff pairs to conflict-check (empty = nothing to check yet). */
  assignments: Assignment[];
  /** The salon-local day the time is typed for. */
  selectedDate: Date | undefined;
  timezone: string;
  mode: "create" | "edit";
  /** In edit mode, exclude this appointment from its own conflict check. */
  appointmentId?: string;
  /** Read the form's current start instant (so it can be saved/restored around the custom-time toggle). */
  getStartTime: () => Date | undefined;
  /** Push the resolved start instant (or clear it) into the form's field. */
  setStartTime: (instant: Date | undefined) => void;
  /** Move the form to a different day (used when a suggestion rolls to a later date). */
  setSelectedDate: (day: Date) => void;
  /** Clear any "pick a slot" error when the custom time changes. */
  clearSlotError: () => void;
}

// Debounce so we don't hit the server on every keystroke. Typing waits a touch longer than the
// (silent) re-check that fires when the provider/date changes underneath a typed time.
const TYPING_DEBOUNCE_MS = 400;
const RECHECK_DEBOUNCE_MS = 300;

/**
 * Owns the "Custom time" toggle's state and its server validation. The tricky part is guarding
 * against out-of-order answers: while one check is in flight the user can re-type, or the provider
 * can change — an older answer landing late must never stamp the newer time as "available". Every
 * entry point bumps `customTimeSeq` first, and each in-flight check drops itself if the ticket
 * moved on. Extracted from the booking form so this race logic can be unit-tested in isolation.
 */
export function useCustomTimeCheck({
  assignments,
  selectedDate,
  timezone,
  mode,
  appointmentId,
  getStartTime,
  setStartTime,
  setSelectedDate,
  clearSlotError,
}: UseCustomTimeCheckParams) {
  // A custom "HH:MM" start time typed by staff — lets them book at any minute (e.g. 9:20), not just
  // the listed interval slots. Empty = using a listed slot. The server still conflict-checks it.
  const [customTime, setCustomTime] = useState<string>("");
  // Toggle in the section header: off = pick a listed slot, on = type a custom minute (slots hidden).
  const [customTimeMode, setCustomTimeMode] = useState<boolean>(false);
  const [customTimeCheck, setCustomTimeCheck] = useState<CustomTimeCheck>({ status: "idle" });
  const customTimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customTimeSeq = useRef(0); // ignore out-of-order validation responses
  // Slot to restore when custom mode is switched off, tagged with the salon-local day it was picked
  // for so we never silently restore a time that belongs to a different (since-changed) date.
  const savedStartTimeRef = useRef<{ instant: Date; dayKey: string } | null>(null);

  // Stable string key of the assignments for the effect dependency.
  const assignmentsKey = assignments.map((s) => `${s.serviceId}:${s.staffId}`).join(",");

  // Build a salon-tz instant for HH:MM on a given day (defaults to the selected day). Returns null if
  // unparseable / no day.
  const buildInstant = (hhmm: string, day?: Date): Date | null => {
    const onDay = day ?? selectedDate;
    if (!hhmm || !onDay) return null;
    const [hh, mm] = hhmm.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const dt = new TZDate(
      onDay.getFullYear(),
      onDay.getMonth(),
      onDay.getDate(),
      hh,
      mm,
      0,
      timezone
    );
    return new Date(dt.getTime());
  };

  // Ask the server whether a typed custom start time is bookable (business hours, past, conflict),
  // then show a friendly inline message. Debounced by the caller; guarded against stale responses.
  const runCustomTimeCheck = async (startInstant: Date) => {
    if (assignments.length === 0) {
      // No service+staff to check against — don't leave the status stuck on "checking".
      setCustomTimeCheck({ status: "idle" });
      return;
    }
    const seq = ++customTimeSeq.current;
    setCustomTimeCheck({ status: "checking" });
    const result = await validateCustomTime({
      assignments,
      startTime: startInstant,
      excludeAppointmentId: mode === "edit" ? appointmentId : undefined,
    });
    if (seq !== customTimeSeq.current) return; // a newer check started — drop this one
    if (!result.success) {
      setCustomTimeCheck({ status: "invalid", message: result.error });
      return;
    }
    const data = result.data;
    if (data.ok) {
      setCustomTimeCheck({ status: "ok" });
      return;
    }
    const message =
      data.reason === "past"
        ? "That time has already passed — pick a later time."
        : data.reason === "outside-hours"
          ? `Outside business hours (${data.openLabel}–${data.closeLabel}).`
          : "That time overlaps another booking for this staff — pick a free time.";
    setCustomTimeCheck({
      status: "invalid",
      message,
      suggestionHHMM: data.suggestionHHMM,
      suggestionLabel: data.suggestionLabel,
      suggestionDateISO: data.suggestionDateISO,
    });
  };

  // Apply a typed custom start time (HH:MM). An optional `day` moves the form to a later date first
  // (used when accepting a suggestion whose next-free slot rolled to another day).
  const applyCustomTime = (hhmm: string, day?: Date) => {
    setCustomTime(hhmm);
    if (day) setSelectedDate(day);
    if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    const onDay = day ?? selectedDate;
    if (!hhmm || !onDay) {
      customTimeSeq.current++; // cancel any in-flight check
      setCustomTimeCheck({ status: "idle" });
      return;
    }
    const instant = buildInstant(hhmm, day);
    if (!instant) return;
    setStartTime(instant);
    clearSlotError();
    // Invalidate any in-flight check NOW (before the debounce), so an older response that lands
    // during the wait can't stamp this newly-typed time as "available".
    customTimeSeq.current++;
    setCustomTimeCheck({ status: "checking" });
    customTimeTimer.current = setTimeout(() => runCustomTimeCheck(instant), TYPING_DEBOUNCE_MS);
  };

  // Flip the "Custom time" header toggle. Turning it on clears any auto-picked slot so nothing
  // books until a minute is typed; turning it off clears the typed time so slot auto-select resumes.
  const setMode = (on: boolean) => {
    setCustomTimeMode(on);
    if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    customTimeSeq.current++; // cancel any in-flight check
    setCustomTimeCheck({ status: "idle" });
    if (on) {
      // Remember the picked slot (and the day it was for) so turning custom time back off restores it
      // instead of losing it.
      const cur = getStartTime();
      savedStartTimeRef.current = cur
        ? { instant: cur, dayKey: formatInTz(cur, "yyyy-MM-dd", timezone) }
        : null;
      setStartTime(undefined);
    } else {
      setCustomTime("");
      const saved = savedStartTimeRef.current;
      // Restore the slot only if the selected day is still the one it was picked for; if the date
      // changed while custom mode was on, restoring the old-day instant would silently move the
      // booking back to that day. Always assign (even with no saved slot) so a typed-then-abandoned
      // custom time can't linger in the form while the UI shows no selected time.
      const selKey = selectedDate ? localDayKey(selectedDate) : null;
      setStartTime(saved && selKey && saved.dayKey === selKey ? saved.instant : undefined);
    }
    clearSlotError();
  };

  // Picking a listed slot clears any custom time (the slot wins). Like the other entry points, bump
  // the sequence and drop any pending debounce so a late in-flight check can't revive the old time.
  const clearForSlot = () => {
    if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    customTimeSeq.current++; // cancel any in-flight check
    setCustomTime("");
    setCustomTimeCheck({ status: "idle" });
  };

  // Re-check a typed custom time whenever the service/staff or date changes, so a "this time is
  // available" message can't go stale after the provider is switched. Typing itself is handled by
  // applyCustomTime; this only covers the OTHER inputs changing.
  useEffect(() => {
    if (!customTimeMode || !customTime) return;
    if (!selectedDate) {
      // The date was cleared out from under a typed custom time — cancel any pending check and reset
      // so a stale "available" can't be submitted.
      if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
      customTimeSeq.current++;
      setCustomTimeCheck({ status: "idle" });
      setStartTime(undefined);
      return;
    }
    const instant = buildInstant(customTime);
    if (!instant) return;
    setStartTime(instant);
    if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    // Invalidate any in-flight check NOW (before the debounce), so a response for the OLD staff/date
    // can't land during the wait and wrongly mark this time available for the new selection.
    customTimeSeq.current++;
    setCustomTimeCheck({ status: "checking" });
    customTimeTimer.current = setTimeout(() => runCustomTimeCheck(instant), RECHECK_DEBOUNCE_MS);
    return () => {
      if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    };
    // Intentionally excludes customTime (typing is handled in applyCustomTime).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentsKey, selectedDate, customTimeMode]);

  // Always clear a pending debounce when the form unmounts, regardless of mode/time, so a scheduled
  // check can't fire (and setState) after the component is gone.
  useEffect(() => {
    return () => {
      if (customTimeTimer.current) clearTimeout(customTimeTimer.current);
    };
  }, []);

  // In custom mode the typed time only counts once the server confirms it; outside custom mode
  // customTime is always cleared, so a listed slot rules instead.
  const customTimeReady = customTime.length > 0 && customTimeCheck.status === "ok";

  return {
    customTime,
    customTimeMode,
    customTimeCheck,
    customTimeReady,
    applyCustomTime,
    setCustomTimeMode: setMode,
    clearForSlot,
  };
}
