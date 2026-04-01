import { TZDate } from "@date-fns/tz";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";

/** Returns "now" in the salon's timezone as a TZDate. */
export function getNow(tz: string): TZDate {
  return new TZDate(new Date(), tz);
}

/** Wraps a UTC Date for display in the salon timezone. */
export function toSalonTz(date: Date | string, tz: string): TZDate {
  return new TZDate(new Date(date), tz);
}

/** Formats a UTC date in the salon timezone using date-fns format tokens. */
export function formatInTz(date: Date | string, pattern: string, tz: string): string {
  return format(toSalonTz(date, tz), pattern);
}

/**
 * Formats a date-only (@db.Date) field for display.
 * Unlike formatInTz, this does NOT apply timezone conversion — because
 * date-only fields represent a calendar date, not a point in time.
 * Prisma returns @db.Date as midnight UTC; converting to a timezone would
 * shift the displayed date by ±1 day.
 */
export function formatDateOnly(date: Date | string, pattern: string): string {
  const d = new Date(date);
  const utcDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return format(utcDate, pattern);
}

/**
 * Returns today's start/end as UTC Dates for Prisma queries,
 * based on the salon timezone.
 */
export function getTodayRange(tz: string): { start: Date; end: Date } {
  const now = getNow(tz);
  const start = startOfDay(now);
  const end = endOfDay(now);
  // Convert TZDate boundaries back to plain UTC Date for Prisma
  return { start: new Date(start.toISOString()), end: new Date(end.toISOString()) };
}

/** Returns this week's start/end as UTC Dates for Prisma queries. */
export function getWeekRange(tz: string): { start: Date; end: Date } {
  const now = getNow(tz);
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const end = endOfWeek(now, { weekStartsOn: 1 });
  return { start: new Date(start.toISOString()), end: new Date(end.toISOString()) };
}

/** Returns this month's start/end as UTC Dates for Prisma queries. */
export function getMonthRange(tz: string): { start: Date; end: Date } {
  const now = getNow(tz);
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  return { start: new Date(start.toISOString()), end: new Date(end.toISOString()) };
}
