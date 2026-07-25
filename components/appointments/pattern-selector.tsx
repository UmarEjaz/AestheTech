"use client";

import { useEffect } from "react";
import { RecurrencePattern } from "@prisma/client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const FULL_DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "Last"] as const;

// "1st", "2nd", "3rd", "21st"… for the day-of-month a monthly series lands on.
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface PatternSelectorProps {
  pattern: RecurrencePattern;
  onPatternChange: (pattern: RecurrencePattern) => void;
  customWeeks?: number;
  onCustomWeeksChange?: (weeks: number) => void;
  specificDays?: number[];
  onSpecificDaysChange?: (days: number[]) => void;
  dayOfWeek?: number;
  onDayOfWeekChange?: (day: number) => void;
  nthWeek?: number;
  onNthWeekChange?: (week: number) => void;
  /** Day-of-month the series lands on (from the appointment's start date) — drives the Monthly note. */
  dayOfMonth?: number;
  disabled?: boolean;
}

// Chip order shown to the user. All app-supported patterns are included (chips wrap as needed).
const PATTERN_ORDER: RecurrencePattern[] = [
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "SPECIFIC_DAYS",
  "NTH_WEEKDAY",
  "CUSTOM",
];

const PATTERN_LABELS: Record<RecurrencePattern, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
  SPECIFIC_DAYS: "Specific days",
  NTH_WEEKDAY: "Nth weekday",
};

// Shared chip styling (matches the checkout/booking chip look — purple when active).
function chipClass(active: boolean) {
  return cn(
    "flex-[1_1_auto] whitespace-nowrap rounded-lg border px-3 py-2 text-center text-[13px] font-semibold transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-input bg-background hover:border-primary/40 hover:bg-accent"
  );
}

export function PatternSelector({
  pattern,
  onPatternChange,
  customWeeks = 3,
  onCustomWeeksChange,
  specificDays = [],
  onSpecificDaysChange,
  dayOfWeek = 0,
  onDayOfWeekChange,
  nthWeek = 1,
  onNthWeekChange,
  dayOfMonth,
  disabled = false,
}: PatternSelectorProps) {
  // For SPECIFIC_DAYS, ensure at least one day is selected.
  useEffect(() => {
    if (pattern === "SPECIFIC_DAYS" && specificDays.length === 0 && onSpecificDaysChange) {
      onSpecificDaysChange([dayOfWeek]);
    }
  }, [pattern, specificDays.length, dayOfWeek, onSpecificDaysChange]);

  const handleSpecificDayToggle = (day: number) => {
    if (!onSpecificDaysChange) return;
    const newDays = specificDays.includes(day)
      ? specificDays.filter((d) => d !== day)
      : [...specificDays, day].sort((a, b) => a - b);
    if (newDays.length > 0) {
      onSpecificDaysChange(newDays);
    }
  };

  const dayOfWeekSelect = (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">Day of the week</Label>
      <Select
        value={dayOfWeek?.toString() ?? "0"}
        onValueChange={(value) => onDayOfWeekChange?.(parseInt(value))}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select day" />
        </SelectTrigger>
        <SelectContent>
          {FULL_DAY_LABELS.map((label, index) => (
            <SelectItem key={index} value={index.toString()}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Recurrence Pattern
      </Label>

      {/* Pattern chips */}
      <div className="flex flex-wrap gap-2">
        {PATTERN_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onPatternChange(key)}
            className={chipClass(pattern === key)}
          >
            {PATTERN_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Contextual fields for the chosen pattern */}
      <div className="mt-2 rounded-xl border bg-muted/40 p-4">
        {(pattern === "WEEKLY" || pattern === "BIWEEKLY") && dayOfWeekSelect}

        {pattern === "DAILY" && (
          <p className="text-sm text-muted-foreground">Repeats every day.</p>
        )}

        {pattern === "MONTHLY" && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <span aria-hidden>📅</span>
            <span>
              Repeats on the{" "}
              <strong className="text-foreground">
                {dayOfMonth ? ordinal(dayOfMonth) : "same date"}
              </strong>{" "}
              of each month — to use a different day, change{" "}
              <strong className="text-foreground">Select Date</strong> above. Monthly series follow
              the calendar date, not a weekday.
            </span>
          </p>
        )}

        {pattern === "CUSTOM" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Repeat interval</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Every</span>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={customWeeks}
                  onChange={(e) => onCustomWeeksChange?.(parseInt(e.target.value) || 1)}
                  className="w-20"
                  disabled={disabled}
                />
                <span className="text-sm text-muted-foreground">week(s)</span>
              </div>
            </div>
            {dayOfWeekSelect}
          </div>
        )}

        {pattern === "SPECIFIC_DAYS" && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Which days of the week?</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LETTERS.map((letter, index) => {
                const active = specificDays.includes(index);
                const onlyOne = specificDays.length === 1 && active;
                return (
                  <button
                    key={index}
                    type="button"
                    disabled={disabled || onlyOne}
                    onClick={() => handleSpecificDayToggle(index)}
                    aria-pressed={active}
                    aria-label={FULL_DAY_LABELS[index]}
                    className={cn(
                      "h-11 w-11 rounded-lg border text-sm font-bold transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:border-primary/40",
                      onlyOne && "cursor-not-allowed opacity-70"
                    )}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Selected: {specificDays.map((d) => FULL_DAY_LABELS[d]).join(", ") || "None"}
            </p>
          </div>
        )}

        {pattern === "NTH_WEEKDAY" && (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Which week</Label>
                <Select
                  value={nthWeek?.toString() ?? "1"}
                  onValueChange={(value) => onNthWeekChange?.(parseInt(value))}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Which week" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEK_LABELS.map((label, index) => (
                      <SelectItem key={index} value={(index + 1).toString()}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {dayOfWeekSelect}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden>📅</span>
              <strong className="text-foreground">
                {WEEK_LABELS[(nthWeek ?? 1) - 1]} {FULL_DAY_LABELS[dayOfWeek ?? 0]}
              </strong>{" "}
              of each month.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Human-readable label for the current pattern configuration.
export function getPatternSummary(
  pattern: RecurrencePattern,
  options?: {
    customWeeks?: number;
    specificDays?: number[];
    dayOfWeek?: number;
    nthWeek?: number;
    dayOfMonth?: number;
  }
): string {
  const { customWeeks = 1, specificDays = [], dayOfWeek = 0, nthWeek = 1, dayOfMonth } = options || {};

  switch (pattern) {
    case "DAILY":
      return "Every day";
    case "WEEKLY":
      return `Every ${FULL_DAY_LABELS[dayOfWeek]}`;
    case "BIWEEKLY":
      return `Every other ${FULL_DAY_LABELS[dayOfWeek]}`;
    case "MONTHLY":
      return dayOfMonth ? `On the ${ordinal(dayOfMonth)} of every month` : "Monthly";
    case "CUSTOM":
      return `Every ${customWeeks} week${customWeeks > 1 ? "s" : ""} on ${FULL_DAY_LABELS[dayOfWeek]}`;
    case "SPECIFIC_DAYS":
      if (specificDays.length === 0) return "Select days";
      if (specificDays.length === 7) return "Every day";
      if (specificDays.length === 5 && !specificDays.includes(0) && !specificDays.includes(6)) {
        return "Weekdays";
      }
      if (specificDays.length === 2 && specificDays.includes(0) && specificDays.includes(6)) {
        return "Weekends";
      }
      return specificDays.map((d) => DAY_LABELS[d]).join(", ");
    case "NTH_WEEKDAY":
      return `${WEEK_LABELS[nthWeek - 1]} ${FULL_DAY_LABELS[dayOfWeek]} of each month`;
    default:
      return pattern;
  }
}
