import { describe, it, expect } from "vitest";
import {
  validateCustomTimeSchema,
  availableSlotsSchema,
  rescheduleSchema,
  calendarQuerySchema,
} from "./appointment";

const oneAssignment = [{ serviceId: "svc_1", staffId: "stf_1" }];

describe("validateCustomTimeSchema", () => {
  it("accepts a valid payload and coerces the ISO start time to a Date", () => {
    const result = validateCustomTimeSchema.safeParse({
      assignments: oneAssignment,
      startTime: "2026-08-07T10:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startTime).toBeInstanceOf(Date);
      expect(result.data.startTime.toISOString()).toBe("2026-08-07T10:00:00.000Z");
    }
  });

  it("rejects an empty assignments list", () => {
    const result = validateCustomTimeSchema.safeParse({
      assignments: [],
      startTime: "2026-08-07T10:00:00Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("At least one service is required");
    }
  });

  it("rejects an assignment missing its staffId", () => {
    const result = validateCustomTimeSchema.safeParse({
      assignments: [{ serviceId: "svc_1", staffId: "" }],
      startTime: "2026-08-07T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 assignments", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ serviceId: `svc_${i}`, staffId: "stf_1" }));
    const result = validateCustomTimeSchema.safeParse({ assignments: many, startTime: new Date() });
    expect(result.success).toBe(false);
  });

  it("rejects a missing start time", () => {
    const result = validateCustomTimeSchema.safeParse({ assignments: oneAssignment });
    expect(result.success).toBe(false);
  });
});

describe("availableSlotsSchema", () => {
  it("accepts a valid request", () => {
    const result = availableSlotsSchema.safeParse({
      assignments: oneAssignment,
      date: "2026-08-07T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });
  it("rejects an empty assignments list", () => {
    const result = availableSlotsSchema.safeParse({ assignments: [], date: new Date() });
    expect(result.success).toBe(false);
  });
});

describe("rescheduleSchema", () => {
  it("accepts a start time without a staffId (optional)", () => {
    const result = rescheduleSchema.safeParse({ startTime: "2026-08-07T10:00:00Z" });
    expect(result.success).toBe(true);
  });
  it("accepts a start time with a staffId", () => {
    const result = rescheduleSchema.safeParse({ startTime: new Date(), staffId: "stf_1" });
    expect(result.success).toBe(true);
  });
  it("rejects a missing start time", () => {
    const result = rescheduleSchema.safeParse({ staffId: "stf_1" });
    expect(result.success).toBe(false);
  });
});

describe("calendarQuerySchema", () => {
  it("accepts a valid range with a staff list", () => {
    const result = calendarQuerySchema.safeParse({
      startDate: "2026-08-01T00:00:00Z",
      endDate: "2026-08-08T00:00:00Z",
      staffIds: ["stf_1", "stf_2"],
    });
    expect(result.success).toBe(true);
  });
  it("accepts an empty range with no staff (all staff)", () => {
    const result = calendarQuerySchema.safeParse({
      startDate: new Date(),
      endDate: new Date(),
    });
    expect(result.success).toBe(true);
  });
  it("rejects an invalid start date", () => {
    const result = calendarQuerySchema.safeParse({ startDate: "not-a-date", endDate: new Date() });
    expect(result.success).toBe(false);
  });
  it("rejects an oversized staff list", () => {
    const many = Array.from({ length: 201 }, (_, i) => `stf_${i}`);
    const result = calendarQuerySchema.safeParse({
      startDate: new Date(),
      endDate: new Date(),
      staffIds: many,
    });
    expect(result.success).toBe(false);
  });
  it("rejects an end date before the start date", () => {
    const result = calendarQuerySchema.safeParse({
      startDate: "2026-08-10T00:00:00Z",
      endDate: "2026-08-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });
  it("rejects a range wider than ~2 months", () => {
    const result = calendarQuerySchema.safeParse({
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-06-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});
