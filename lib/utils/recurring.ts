import {
  addDays,
  addWeeks,
  addMonths,
  setHours,
  setMinutes,
  startOfDay,
  getDay,
  setDay,
  format,
  isBefore,
  isAfter,
  isSameDay,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";
import { RecurrencePattern, RecurrenceEndType } from "@prisma/client";

// Day names for display
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Nth week labels
export const NTH_WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "Last"] as const;

/**
 * Get human-readable label for recurrence pattern
 */
export function getPatternLabel(
  pattern: RecurrencePattern,
  options?: {
    customWeeks?: number | null;
    specificDays?: number[];
    nthWeek?: number | null;
    dayOfWeek?: number;
  }
): string {
  switch (pattern) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "BIWEEKLY":
      return "Every 2 weeks";
    case "MONTHLY":
      return "Monthly";
    case "CUSTOM": {
      const weeks = options?.customWeeks || 1;
      return `Every ${weeks} week${weeks > 1 ? "s" : ""}`;
    }
    case "SPECIFIC_DAYS":
      if (options?.specificDays && options.specificDays.length > 0) {
        const dayLabels = [...options.specificDays]
          .sort((a, b) => a - b)
          .map((d) => DAY_NAMES_SHORT[d]);
        return `Every ${dayLabels.join(", ")}`;
      }
      return "Specific days";
    case "NTH_WEEKDAY":
      if (options?.nthWeek != null && options?.dayOfWeek !== undefined) {
        const nthLabel = options.nthWeek === 5 ? "Last" : NTH_WEEK_LABELS[options.nthWeek - 1];
        return `${nthLabel} ${DAY_NAMES[options.dayOfWeek]} of each month`;
      }
      return "Nth weekday of month";
    default:
      return pattern;
  }
}

/**
 * Parse time string "HH:mm" to hours and minutes
 */
export function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
}

/**
 * Set time on a date from "HH:mm" string
 */
export function setTimeOnDate(date: Date, timeOfDay: string): Date {
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  return setMinutes(setHours(startOfDay(date), hours), minutes);
}

/**
 * Get the next occurrence of a specific day of week from a given date
 */
export function getNextDayOfWeek(dayOfWeek: number, fromDate: Date = new Date()): Date {
  const currentDay = getDay(fromDate);
  let daysUntilNext = dayOfWeek - currentDay;

  if (daysUntilNext < 0) {
    daysUntilNext += 7;
  }

  // If it's today, return today (caller handles time check)
  return addDays(startOfDay(fromDate), daysUntilNext);
}

/**
 * Get the Nth occurrence of a specific weekday in a given month
 * @param year - Year
 * @param month - Month (0-11)
 * @param dayOfWeek - Day of week (0-6, 0=Sunday)
 * @param nth - Which occurrence (1-4, or 5 for last)
 */
export function getNthWeekdayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  nth: number
): Date | null {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const monthEnd = endOfMonth(monthStart);

  // Get all days in the month that match the weekday
  const matchingDays = eachDayOfInterval({ start: monthStart, end: monthEnd }).filter(
    (date) => getDay(date) === dayOfWeek
  );

  if (matchingDays.length === 0) return null;

  // nth = 5 means "last"
  if (nth === 5) {
    return matchingDays[matchingDays.length - 1];
  }

  // Return the nth occurrence (1-indexed)
  if (nth >= 1 && nth <= matchingDays.length) {
    return matchingDays[nth - 1];
  }

  return null;
}

/**
 * Configuration for generating recurring dates
 */
export interface RecurringDateConfig {
  pattern: RecurrencePattern;
  startDate: Date;
  timeOfDay: string;
  dayOfWeek: number;
  customWeeks?: number | null;
  specificDays?: number[];
  nthWeek?: number | null;
  endType: RecurrenceEndType;
  endAfterCount?: number | null;
  endByDate?: Date | null;
  exceptionDates?: Date[];
  maxDates?: number; // Safety limit
}

/**
 * Calculate recurring dates based on pattern and configuration
 */
export function calculateRecurringDates(config: RecurringDateConfig): Date[] {
  const {
    pattern,
    startDate,
    timeOfDay,
    dayOfWeek,
    customWeeks,
    specificDays,
    nthWeek,
    endType,
    endAfterCount,
    endByDate,
    exceptionDates = [],
    maxDates = 100, // Safety limit
  } = config;

  const dates: Date[] = [];
  const now = new Date();
  const { hours, minutes } = parseTimeOfDay(timeOfDay);

  // Determine end condition
  // Use max(startDate, now) as horizon base so future-dated series still generate dates
  const horizonBase = isAfter(startDate, now) ? startDate : now;

  let shouldContinue = (currentDate: Date, count: number): boolean => {
    if (count >= maxDates) return false;

    switch (endType) {
      case "NEVER":
        // Default: generate for 3 months ahead from the later of startDate or now
        return isBefore(currentDate, addMonths(horizonBase, 3));
      case "AFTER_COUNT":
        return count < (endAfterCount || 1);
      case "BY_DATE":
        return endByDate ? isBefore(currentDate, endByDate) || isSameDay(currentDate, endByDate) : false;
      default:
        return count < maxDates;
    }
  };

  // Check if date is an exception
  const isException = (date: Date): boolean => {
    return exceptionDates.some((excDate) => isSameDay(date, excDate));
  };

  // Generate dates based on pattern
  switch (pattern) {
    case "DAILY": {
      let currentDate = startOfDay(startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        if (!isBefore(currentDate, startOfDay(now)) && !isException(currentDate)) {
          dates.push(setMinutes(setHours(currentDate, hours), minutes));
          count++;
        }
        currentDate = addDays(currentDate, 1);
      }
      break;
    }

    case "WEEKLY": {
      let currentDate = getNextDayOfWeek(dayOfWeek, startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        if (!isBefore(currentDate, startOfDay(now)) && !isException(currentDate)) {
          dates.push(setMinutes(setHours(currentDate, hours), minutes));
          count++;
        }
        currentDate = addWeeks(currentDate, 1);
      }
      break;
    }

    case "BIWEEKLY": {
      let currentDate = getNextDayOfWeek(dayOfWeek, startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        if (!isBefore(currentDate, startOfDay(now)) && !isException(currentDate)) {
          dates.push(setMinutes(setHours(currentDate, hours), minutes));
          count++;
        }
        currentDate = addWeeks(currentDate, 2);
      }
      break;
    }

    case "MONTHLY": {
      // MONTHLY = same day-of-month each month (e.g., 15th of every month)
      // For shorter months, clamp to last day (e.g., Jan 31 -> Feb 28)
      const originalDayOfMonth = startDate.getDate();
      let currentDate = new Date(startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        // Clamp to last day of month if original day doesn't exist
        const lastDayOfMonth = endOfMonth(currentDate).getDate();
        const targetDayOfMonth = Math.min(originalDayOfMonth, lastDayOfMonth);
        const targetDate = new Date(currentDate);
        targetDate.setDate(targetDayOfMonth);

        if (!isBefore(targetDate, startOfDay(now)) && !isException(targetDate)) {
          dates.push(setMinutes(setHours(targetDate, hours), minutes));
          count++;
        }
        currentDate = addMonths(currentDate, 1);
      }
      break;
    }

    case "CUSTOM": {
      const weeks = customWeeks || 1;
      let currentDate = getNextDayOfWeek(dayOfWeek, startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        if (!isBefore(currentDate, startOfDay(now)) && !isException(currentDate)) {
          dates.push(setMinutes(setHours(currentDate, hours), minutes));
          count++;
        }
        currentDate = addWeeks(currentDate, weeks);
      }
      break;
    }

    case "SPECIFIC_DAYS": {
      if (!specificDays || specificDays.length === 0) break;

      let currentDate = startOfDay(startDate);
      let count = 0;

      while (shouldContinue(currentDate, count)) {
        const currentDayOfWeek = getDay(currentDate);

        if (specificDays.includes(currentDayOfWeek)) {
          if (!isBefore(currentDate, startOfDay(now)) && !isException(currentDate)) {
            dates.push(setMinutes(setHours(currentDate, hours), minutes));
            count++;
          }
        }
        currentDate = addDays(currentDate, 1);
      }
      break;
    }

    case "NTH_WEEKDAY": {
      if (nthWeek === undefined || nthWeek === null) break;

      let currentMonth = new Date(startDate);
      let count = 0;

      while (shouldContinue(currentMonth, count)) {
        const nthDate = getNthWeekdayOfMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          dayOfWeek,
          nthWeek
        );

        if (nthDate && !isBefore(nthDate, startOfDay(now)) && !isException(nthDate)) {
          dates.push(setMinutes(setHours(nthDate, hours), minutes));
          count++;
        }
        currentMonth = addMonths(currentMonth, 1);
      }
      break;
    }
  }

  return dates;
}

/**
 * Calculate how many occurrences would be generated with given config
 */
export function estimateOccurrences(config: Omit<RecurringDateConfig, "exceptionDates">): number {
  // For NEVER end type, estimate based on 3 months
  if (config.endType === "NEVER") {
    const monthsAhead = 3;
    switch (config.pattern) {
      case "DAILY":
        return monthsAhead * 30;
      case "WEEKLY":
        return monthsAhead * 4;
      case "BIWEEKLY":
        return monthsAhead * 2;
      case "MONTHLY":
        return monthsAhead;
      case "CUSTOM":
        return Math.ceil((monthsAhead * 4) / (config.customWeeks || 1));
      case "SPECIFIC_DAYS":
        return monthsAhead * 4 * (config.specificDays?.length || 1);
      case "NTH_WEEKDAY":
        return monthsAhead;
      default:
        return 12;
    }
  }

  if (config.endType === "AFTER_COUNT") {
    return config.endAfterCount || 1;
  }

  if (config.endType === "BY_DATE" && config.endByDate) {
    // Calculate based on date range
    const dates = calculateRecurringDates({
      ...config,
      exceptionDates: [],
      maxDates: 365, // Max 1 year
    });
    return dates.length;
  }

  return 12; // Default estimate
}

/**
 * Validate recurrence configuration
 */
export function validateRecurrenceConfig(config: Partial<RecurringDateConfig>): string[] {
  const errors: string[] = [];

  if (!config.pattern) {
    errors.push("Pattern is required");
  }

  if (!config.timeOfDay || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(config.timeOfDay)) {
    errors.push("Valid time of day (HH:mm) is required");
  }

  if (config.dayOfWeek === undefined || config.dayOfWeek < 0 || config.dayOfWeek > 6) {
    if (config.pattern !== "DAILY" && config.pattern !== "SPECIFIC_DAYS") {
      errors.push("Day of week (0-6) is required");
    }
  }

  if (config.pattern === "CUSTOM" && (!config.customWeeks || config.customWeeks < 1)) {
    errors.push("Custom weeks must be at least 1");
  }

  if (config.pattern === "SPECIFIC_DAYS" && (!config.specificDays || config.specificDays.length === 0)) {
    errors.push("At least one day must be selected for specific days pattern");
  }

  if (config.pattern === "NTH_WEEKDAY" && (!config.nthWeek || config.nthWeek < 1 || config.nthWeek > 5)) {
    errors.push("Nth week (1-5) is required for nth weekday pattern");
  }

  if (config.endType === "AFTER_COUNT" && (!config.endAfterCount || config.endAfterCount < 1)) {
    errors.push("End after count must be at least 1");
  }

  if (config.endType === "BY_DATE" && !config.endByDate) {
    errors.push("End by date is required");
  }

  return errors;
}

/**
 * Get preview dates (limited number for UI display)
 */
export function getPreviewDates(
  config: Omit<RecurringDateConfig, "exceptionDates">,
  limit: number = 6
): Date[] {
  return calculateRecurringDates({
    ...config,
    exceptionDates: [],
    maxDates: limit,
  });
}

/**
 * Format recurrence summary for display
 */
export function formatRecurrenceSummary(config: {
  pattern: RecurrencePattern;
  dayOfWeek: number;
  timeOfDay: string;
  customWeeks?: number | null;
  specificDays?: number[];
  nthWeek?: number | null;
  endType: RecurrenceEndType;
  endAfterCount?: number | null;
  endByDate?: Date | null;
}): string {
  const patternLabel = getPatternLabel(config.pattern, {
    customWeeks: config.customWeeks,
    specificDays: config.specificDays,
    nthWeek: config.nthWeek,
    dayOfWeek: config.dayOfWeek,
  });

  const { hours, minutes } = parseTimeOfDay(config.timeOfDay);
  const timeStr = format(setMinutes(setHours(new Date(), hours), minutes), "h:mm a");

  let summary = `${patternLabel} at ${timeStr}`;

  // Add day info for relevant patterns
  if (["WEEKLY", "BIWEEKLY", "CUSTOM"].includes(config.pattern)) {
    summary += ` on ${DAY_NAMES[config.dayOfWeek]}s`;
  }

  // Add end condition
  switch (config.endType) {
    case "AFTER_COUNT":
      summary += `, ${config.endAfterCount} occurrence${(config.endAfterCount || 1) > 1 ? "s" : ""}`;
      break;
    case "BY_DATE":
      if (config.endByDate) {
        summary += `, until ${format(config.endByDate, "MMM d, yyyy")}`;
      }
      break;
    case "NEVER":
      summary += `, ongoing`;
      break;
  }

  return summary;
}
