import { describe, it, expect } from "vitest";
import { formatInTz, formatTimeRangeInTz, formatDateOnly } from "./timezone";

// Asia/Karachi is UTC+5 year-round (no DST), which keeps these assertions unambiguous.
const KHI = "Asia/Karachi";

describe("formatInTz", () => {
  it("converts a UTC instant into the salon timezone", () => {
    // 04:00 UTC + 5h = 09:00 in Karachi
    expect(formatInTz("2026-08-07T04:00:00Z", "h:mm a", KHI)).toBe("9:00 AM");
    expect(formatInTz("2026-08-07T04:00:00Z", "h a", KHI)).toBe("9 AM");
  });

  it("accepts a Date object as well as an ISO string", () => {
    const d = new Date("2026-08-07T09:30:00Z"); // 14:30 Karachi
    expect(formatInTz(d, "h:mm a", KHI)).toBe("2:30 PM");
  });

  it("rolls the calendar day when the zone offset crosses midnight", () => {
    // 20:00 UTC on the 7th = 01:00 on the 8th in Karachi
    expect(formatInTz("2026-08-07T20:00:00Z", "yyyy-MM-dd", KHI)).toBe("2026-08-08");
  });
});

describe("formatTimeRangeInTz", () => {
  it("shares the meridiem and drops :00 on whole hours (same half of day)", () => {
    // 9:00 AM -> 9:30 AM
    expect(
      formatTimeRangeInTz("2026-08-07T04:00:00Z", "2026-08-07T04:30:00Z", KHI)
    ).toBe("9–9:30 AM");
  });

  it("drops :00 on both ends when both are whole hours", () => {
    // 10 AM -> 11 AM
    expect(
      formatTimeRangeInTz("2026-08-07T05:00:00Z", "2026-08-07T06:00:00Z", KHI)
    ).toBe("10–11 AM");
  });

  it("shows both meridiems when the range crosses noon", () => {
    // 11:30 AM -> 1:00 PM
    expect(
      formatTimeRangeInTz("2026-08-07T06:30:00Z", "2026-08-07T08:00:00Z", KHI)
    ).toBe("11:30 AM–1 PM");
  });

  it("keeps minutes on both ends when neither is a whole hour", () => {
    // 9:20 AM -> 9:40 AM
    expect(
      formatTimeRangeInTz("2026-08-07T04:20:00Z", "2026-08-07T04:40:00Z", KHI)
    ).toBe("9:20–9:40 AM");
  });
});

describe("formatDateOnly", () => {
  it("formats the UTC calendar day without shifting timezone", () => {
    // Late-evening UTC must not roll to the next day (no tz conversion here).
    expect(formatDateOnly("2026-08-07T23:00:00Z", "yyyy-MM-dd")).toBe("2026-08-07");
    expect(formatDateOnly("2026-08-07T00:00:00Z", "MMM d")).toBe("Aug 7");
  });
});
