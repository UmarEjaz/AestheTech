import { describe, it, expect, vi } from "vitest";
import type { RecurrencePattern, RecurrenceEndType } from "@prisma/client";
import {
  parseTimeOfDay,
  setTimeOnDate,
  getNthWeekdayOfMonth,
  validateRecurrenceConfig,
  calculateRecurringDates,
  type RecurringDateConfig,
} from "./recurring";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

// startDate a few days in the future so every counted occurrence is also emitted
// (calculateRecurringDates only emits dates on/after "now").
const future = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

describe("parseTimeOfDay", () => {
  it("parses HH:mm", () => {
    expect(parseTimeOfDay("09:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay("23:00")).toEqual({ hours: 23, minutes: 0 });
  });
  it("falls back to 0 for malformed input", () => {
    expect(parseTimeOfDay("")).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("setTimeOnDate", () => {
  it("stamps the given time onto the date's day", () => {
    const result = setTimeOnDate(new Date(2026, 7, 7), "09:30");
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
  });
});

describe("getNthWeekdayOfMonth", () => {
  // Aug 2026 starts on a Saturday; Mondays fall on the 3rd, 10th, 17th, 24th, 31st.
  it("returns the 1st Monday of the month", () => {
    const d = getNthWeekdayOfMonth(2026, 7, 1, 1)!;
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(3);
  });
  it("treats nth=5 as the last occurrence", () => {
    const d = getNthWeekdayOfMonth(2026, 7, 1, 5)!;
    expect(d.getDate()).toBe(31);
  });
  it("returns null for an impossible occurrence", () => {
    expect(getNthWeekdayOfMonth(2026, 7, 1, 0)).toBeNull();
  });
});

describe("validateRecurrenceConfig", () => {
  it("accepts a valid weekly config", () => {
    expect(
      validateRecurrenceConfig({
        pattern: "WEEKLY" as RecurrencePattern,
        timeOfDay: "09:30",
        dayOfWeek: 1,
        endType: "NEVER" as RecurrenceEndType,
      })
    ).toEqual([]);
  });
  it("flags a missing pattern and a non-padded time", () => {
    const errors = validateRecurrenceConfig({ timeOfDay: "9:30", dayOfWeek: 1 });
    expect(errors).toContain("Pattern is required");
    expect(errors).toContain("Valid time of day (HH:mm) is required");
  });
  it("requires specificDays for the SPECIFIC_DAYS pattern", () => {
    expect(
      validateRecurrenceConfig({
        pattern: "SPECIFIC_DAYS" as RecurrencePattern,
        timeOfDay: "10:00",
        dayOfWeek: 0,
      })
    ).toContain("At least one day must be selected for specific days pattern");
  });
  it("requires endAfterCount when ending after a count", () => {
    expect(
      validateRecurrenceConfig({
        pattern: "DAILY" as RecurrencePattern,
        timeOfDay: "10:00",
        dayOfWeek: 0,
        endType: "AFTER_COUNT" as RecurrenceEndType,
      })
    ).toContain("End after count must be at least 1");
  });
});

describe("calculateRecurringDates", () => {
  const base = (overrides: Partial<RecurringDateConfig>): RecurringDateConfig => ({
    pattern: "DAILY" as RecurrencePattern,
    startDate: future(10),
    timeOfDay: "10:00",
    dayOfWeek: 1,
    endType: "AFTER_COUNT" as RecurrenceEndType,
    endAfterCount: 3,
    timeZone: "UTC",
    ...overrides,
  });

  it("emits exactly `endAfterCount` daily occurrences, one day apart", () => {
    const dates = calculateRecurringDates(base({}));
    expect(dates).toHaveLength(3);
    expect(dates[1].getTime() - dates[0].getTime()).toBe(DAY);
    expect(dates[2].getTime() - dates[1].getTime()).toBe(DAY);
  });

  it("spaces weekly occurrences 7 days apart", () => {
    const dates = calculateRecurringDates(base({ pattern: "WEEKLY" as RecurrencePattern, endAfterCount: 4 }));
    expect(dates).toHaveLength(4);
    expect(dates[1].getTime() - dates[0].getTime()).toBe(WEEK);
    expect(dates[3].getTime() - dates[2].getTime()).toBe(WEEK);
  });

  it("skips exception dates while still reaching the requested count", () => {
    const start = future(10);
    const secondDay = new Date(start.getTime() + DAY); // the occurrence to skip
    const dates = calculateRecurringDates(base({ startDate: start, exceptionDates: [secondDay] }));
    expect(dates).toHaveLength(3);
    const skipped = secondDay.toISOString().slice(0, 10);
    expect(dates.map((d) => d.toISOString().slice(0, 10))).not.toContain(skipped);
  });

  it("keeps the wall-clock time across a DST transition in a non-UTC zone", () => {
    // The UTC cases above rely on a fixed 24h/7d delta. In a DST-observing zone that assumption breaks:
    // across the fall-back boundary two daily 10 AM occurrences are 25h apart, not 24h. This case is
    // what catches a regression in the salon-timezone (TZDate) math. Pin "now" just before the US
    // 2026 fall-back (Sun Nov 1, 02:00) so the series deterministically spans it.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
      const tz = "America/New_York";
      const dates = calculateRecurringDates(
        base({
          pattern: "DAILY" as RecurrencePattern,
          startDate: new Date("2026-10-31T04:00:00Z"), // Oct 31, 00:00 EDT — before the transition
          timeOfDay: "10:00",
          endAfterCount: 4,
          timeZone: tz,
        })
      );
      expect(dates).toHaveLength(4);
      // Every occurrence stays at 10:00 wall-clock in the salon zone, even across the DST boundary.
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      for (const d of dates) expect(fmt.format(d)).toBe("10:00");
      // Which means the raw spacing is NOT a constant 24h across the fall-back (one gap is 25h) — the
      // exact thing a fixed-millisecond implementation would get wrong.
      const deltas = dates.slice(1).map((d, i) => d.getTime() - dates[i].getTime());
      expect(deltas.some((ms) => ms !== DAY)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
