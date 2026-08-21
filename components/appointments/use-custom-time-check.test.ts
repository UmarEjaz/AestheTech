// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCustomTimeCheck } from "./use-custom-time-check";

// The hook's only side effect is calling validateCustomTime on the server — mock it so we can
// control WHEN each answer lands and prove the stale-answer guard + edit-mode wiring.
vi.mock("@/lib/actions/appointment", () => ({
  validateCustomTime: vi.fn(),
}));
import { validateCustomTime } from "@/lib/actions/appointment";

const mockValidate = vi.mocked(validateCustomTime);

// A promise we resolve by hand, so we can hold one server answer "in flight" while triggering another.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Flush pending microtasks (the awaited validateCustomTime continuations) inside act.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const SELECTED_DATE = new Date(2026, 7, 20); // Aug 20 2026

function makeParams(
  overrides: Partial<Parameters<typeof useCustomTimeCheck>[0]> = {}
): Parameters<typeof useCustomTimeCheck>[0] {
  return {
    assignments: [{ serviceId: "svc-1", staffId: "staff-A" }],
    selectedDate: SELECTED_DATE,
    timezone: "America/New_York",
    mode: "create",
    appointmentId: undefined,
    getStartTime: vi.fn(() => undefined),
    setStartTime: vi.fn(),
    setSelectedDate: vi.fn(),
    clearSlotError: vi.fn(),
    ...overrides,
  };
}

describe("useCustomTimeCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockValidate.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms a bookable time as available", async () => {
    mockValidate.mockResolvedValue({ success: true, data: { ok: true } });
    const { result } = renderHook(() => useCustomTimeCheck(makeParams()));

    act(() => result.current.applyCustomTime("09:20"));
    expect(result.current.customTimeCheck.status).toBe("checking");

    await act(async () => {
      vi.advanceTimersByTime(400); // fire the debounced check
    });
    await flush();

    expect(result.current.customTimeCheck.status).toBe("ok");
    expect(result.current.customTimeReady).toBe(true);
  });

  it("drops a stale answer when the user re-types before it lands", async () => {
    const first = deferred<Awaited<ReturnType<typeof validateCustomTime>>>();
    const second = deferred<Awaited<ReturnType<typeof validateCustomTime>>>();
    mockValidate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useCustomTimeCheck(makeParams()));

    // Type 9:20 and let its check go in flight.
    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Re-type 9:40 before the 9:20 answer lands, and let ITS check go in flight.
    act(() => result.current.applyCustomTime("09:40"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // The stale 9:20 answer says "available" — it must be ignored (the ticket moved on).
    await act(async () => {
      first.resolve({ success: true, data: { ok: true } });
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("checking");

    // The current 9:40 answer wins.
    await act(async () => {
      second.resolve({
        success: true,
        data: { ok: false, reason: "conflict", suggestionHHMM: "10:00", suggestionLabel: "10 AM" },
      });
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("invalid");
    expect(result.current.customTimeCheck.suggestionHHMM).toBe("10:00");

    expect(mockValidate).toHaveBeenCalledTimes(2);
  });

  it("clearForSlot drops an in-flight check so a late 'available' can't revive a replaced time", async () => {
    const inflight = deferred<Awaited<ReturnType<typeof validateCustomTime>>>();
    mockValidate.mockReturnValueOnce(inflight.promise);

    const { result } = renderHook(() => useCustomTimeCheck(makeParams()));

    // Type a custom time and let its check go in flight.
    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.customTimeCheck.status).toBe("checking");

    // The user picks a listed slot instead → clearForSlot cancels the pending check and resets to idle.
    act(() => result.current.clearForSlot());
    expect(result.current.customTimeCheck.status).toBe("idle");

    // The old check's answer lands late saying "available" — it must NOT revive the cleared time.
    await act(async () => {
      inflight.resolve({ success: true, data: { ok: true } });
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("idle");
    expect(result.current.customTimeReady).toBe(false);
  });

  it("drops a stale answer when the provider changes mid-check", async () => {
    const first = deferred<Awaited<ReturnType<typeof validateCustomTime>>>();
    const second = deferred<Awaited<ReturnType<typeof validateCustomTime>>>();
    mockValidate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook((props) => useCustomTimeCheck(props), {
      initialProps: makeParams(),
    });

    // Turn on custom mode and type a time (staff-A check goes in flight).
    act(() => result.current.setCustomTimeMode(true));
    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Switch the provider to staff-B — the re-check effect fires for the new selection.
    rerender(makeParams({ assignments: [{ serviceId: "svc-1", staffId: "staff-B" }] }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // The stale staff-A answer ("available") must not win.
    await act(async () => {
      first.resolve({ success: true, data: { ok: true } });
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("checking");

    // The staff-B answer wins, and it was the one actually asked about.
    await act(async () => {
      second.resolve({
        success: true,
        data: { ok: false, reason: "conflict", suggestionHHMM: "11:00", suggestionLabel: "11 AM" },
      });
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("invalid");

    expect(mockValidate).toHaveBeenCalledTimes(2);
    expect(mockValidate.mock.calls[1][0].assignments[0].staffId).toBe("staff-B");
  });

  it("excludes the current appointment from its own check in edit mode", async () => {
    mockValidate.mockResolvedValue({ success: true, data: { ok: true } });
    const { result } = renderHook(() =>
      useCustomTimeCheck(makeParams({ mode: "edit", appointmentId: "appt-99" }))
    );

    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();

    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockValidate.mock.calls[0][0].excludeAppointmentId).toBe("appt-99");
  });

  it("applying a suggestion on a later day moves the date and validates that day", async () => {
    mockValidate.mockResolvedValue({ success: true, data: { ok: true } });
    const params = makeParams(); // timezone America/New_York
    const { result } = renderHook(() => useCustomTimeCheck(params));

    const laterDay = new Date(2026, 8, 1); // Sep 1 2026 (floating local Y/M/D)
    act(() => result.current.applyCustomTime("12:20", laterDay));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();

    // The form was moved to the suggested day...
    expect(params.setSelectedDate).toHaveBeenCalledWith(laterDay);
    // ...and the time validated is 12:20 on THAT day (in the salon timezone), not the original day.
    expect(mockValidate).toHaveBeenCalledTimes(1);
    const sent = mockValidate.mock.calls[0][0].startTime as Date;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(sent);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(sent);
    expect(day).toBe("2026-09-01");
    expect(time).toBe("12:20");
  });

  it("resets a validated custom time when the selected date is cleared", async () => {
    mockValidate.mockResolvedValue({ success: true, data: { ok: true } });
    const { result, rerender } = renderHook((props) => useCustomTimeCheck(props), {
      initialProps: makeParams(),
    });

    act(() => result.current.setCustomTimeMode(true));
    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    expect(result.current.customTimeCheck.status).toBe("ok");
    expect(result.current.customTimeReady).toBe(true);

    // Clear the date out from under the validated time — the stale "available" must not remain.
    const cleared = makeParams({ selectedDate: undefined });
    rerender(cleared);
    await flush();

    expect(result.current.customTimeCheck.status).toBe("idle");
    expect(result.current.customTimeReady).toBe(false);
    expect(cleared.setStartTime).toHaveBeenCalledWith(undefined);
  });

  it("restores the previously picked slot when custom mode is turned back off (same day)", () => {
    // Turning custom time ON must remember the slot that was already picked, and turning it OFF must
    // put that slot back (instead of leaving the booking with no time) — as long as the day is unchanged.
    // 11:00 in America/New_York on Aug 20, matching SELECTED_DATE's day.
    const picked = new Date("2026-08-20T15:00:00Z");
    const params = makeParams({ getStartTime: () => picked });
    const { result } = renderHook(() => useCustomTimeCheck(params));

    act(() => result.current.setCustomTimeMode(true));
    expect(params.setStartTime).toHaveBeenCalledWith(undefined); // slot cleared while typing a custom time

    act(() => result.current.setCustomTimeMode(false));
    expect(params.setStartTime).toHaveBeenLastCalledWith(picked); // original slot restored
  });

  it("does NOT restore the saved slot when the day changed while custom mode was on", () => {
    // Pick a slot on Aug 20, enable custom mode, then move to Aug 21 and disable custom mode. Restoring
    // the Aug 20 instant here would silently move the booking back to Aug 20 (the reported edit-mode
    // bug) — so the time must be cleared instead.
    const picked = new Date("2026-08-20T15:00:00Z"); // NY day = Aug 20
    const day1 = makeParams({ getStartTime: () => picked, selectedDate: new Date(2026, 7, 20) });
    const { result, rerender } = renderHook((props) => useCustomTimeCheck(props), {
      initialProps: day1,
    });

    act(() => result.current.setCustomTimeMode(true)); // saves picked (day = Aug 20), clears start

    // The user moves to a different day while custom mode is still on.
    const day2 = makeParams({ getStartTime: () => picked, selectedDate: new Date(2026, 7, 21) });
    rerender(day2);

    act(() => result.current.setCustomTimeMode(false)); // must NOT restore the Aug 20 instant
    expect(day2.setStartTime).toHaveBeenLastCalledWith(undefined);
    expect(day2.setStartTime).not.toHaveBeenCalledWith(picked);
  });

  it("clears the start time on disable when no slot was picked (no lingering typed time)", () => {
    // No slot was chosen (getStartTime → undefined). Enabling clears the field; disabling must ALSO
    // clear it, so a custom time typed-then-abandoned can't stay in the form after the toggle goes off.
    const params = makeParams({ getStartTime: () => undefined });
    const { result } = renderHook(() => useCustomTimeCheck(params));

    act(() => result.current.setCustomTimeMode(true));
    act(() => result.current.setCustomTimeMode(false));

    // Both the enable and the disable clear the field; neither restores a value.
    expect(params.setStartTime).toHaveBeenCalledTimes(2);
    expect(params.setStartTime).toHaveBeenNthCalledWith(1, undefined);
    expect(params.setStartTime).toHaveBeenNthCalledWith(2, undefined);
  });

  it("does not send an exclude id when creating a new appointment", async () => {
    mockValidate.mockResolvedValue({ success: true, data: { ok: true } });
    const { result } = renderHook(() => useCustomTimeCheck(makeParams({ mode: "create" })));

    act(() => result.current.applyCustomTime("09:20"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();

    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockValidate.mock.calls[0][0].excludeAppointmentId).toBeUndefined();
  });
});
