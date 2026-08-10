import { describe, it, expect } from "vitest";
import { generateRRule } from "./ical";

describe("generateRRule", () => {
  it("builds a simple daily rule", () => {
    expect(generateRRule({ pattern: "DAILY" })).toBe("FREQ=DAILY");
  });

  it("builds a weekly rule with the weekday", () => {
    expect(generateRRule({ pattern: "WEEKLY", dayOfWeek: 1 })).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("expresses biweekly as WEEKLY with INTERVAL=2", () => {
    expect(generateRRule({ pattern: "BIWEEKLY", dayOfWeek: 3 })).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"
    );
  });

  it("uses customWeeks as the interval", () => {
    expect(generateRRule({ pattern: "CUSTOM", customWeeks: 3, dayOfWeek: 5 })).toBe(
      "FREQ=WEEKLY;INTERVAL=3;BYDAY=FR"
    );
  });

  it("lists all selected days for SPECIFIC_DAYS", () => {
    expect(generateRRule({ pattern: "SPECIFIC_DAYS", specificDays: [1, 3, 5] })).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR"
    );
  });

  it("maps NTH_WEEKDAY nth=2 to a positional BYDAY", () => {
    expect(generateRRule({ pattern: "NTH_WEEKDAY", dayOfWeek: 2, nthWeek: 2 })).toBe(
      "FREQ=MONTHLY;BYDAY=2TU"
    );
  });

  it("maps NTH_WEEKDAY nth=5 (last) to -1", () => {
    expect(generateRRule({ pattern: "NTH_WEEKDAY", dayOfWeek: 1, nthWeek: 5 })).toBe(
      "FREQ=MONTHLY;BYDAY=-1MO"
    );
  });

  it("appends COUNT for AFTER_COUNT", () => {
    expect(
      generateRRule({ pattern: "WEEKLY", dayOfWeek: 1, endType: "AFTER_COUNT", endAfterCount: 5 })
    ).toBe("FREQ=WEEKLY;BYDAY=MO;COUNT=5");
  });

  it("appends an end-of-day UNTIL for BY_DATE", () => {
    expect(
      generateRRule({
        pattern: "DAILY",
        endType: "BY_DATE",
        endByDate: new Date("2026-08-31T00:00:00Z"),
      })
    ).toBe("FREQ=DAILY;UNTIL=20260831T235959Z");
  });
});
