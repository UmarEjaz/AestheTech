"use client";

import { useEffect } from "react";
import { RecurrencePattern } from "@prisma/client";
import { CalendarDays, CalendarRange, Calendar, Repeat, Hash, Grid3X3, CalendarCheck } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const FULL_DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "Last"] as const;

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
  disabled?: boolean;
  compact?: boolean;
}

const patternConfig: Record<
  RecurrencePattern,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  DAILY: {
    label: "Daily",
    description: "Every day",
    icon: Calendar,
  },
  WEEKLY: {
    label: "Weekly",
    description: "Same day each week",
    icon: CalendarDays,
  },
  BIWEEKLY: {
    label: "Bi-weekly",
    description: "Every 2 weeks",
    icon: CalendarRange,
  },
  MONTHLY: {
    label: "Monthly",
    description: "Same day each month",
    icon: CalendarCheck,
  },
  CUSTOM: {
    label: "Custom",
    description: "Every N weeks",
    icon: Hash,
  },
  SPECIFIC_DAYS: {
    label: "Specific Days",
    description: "Select multiple days per week",
    icon: Grid3X3,
  },
  NTH_WEEKDAY: {
    label: "Nth Weekday",
    description: "e.g., 2nd Tuesday of each month",
    icon: Repeat,
  },
};

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
  disabled = false,
  compact = false,
}: PatternSelectorProps) {
  // For SPECIFIC_DAYS, ensure at least one day is selected
  useEffect(() => {
    if (pattern === "SPECIFIC_DAYS" && specificDays.length === 0 && onSpecificDaysChange) {
      // Default to the current dayOfWeek if available
      onSpecificDaysChange([dayOfWeek]);
    }
  }, [pattern, specificDays.length, dayOfWeek, onSpecificDaysChange]);

  const handleSpecificDayToggle = (day: number) => {
    if (!onSpecificDaysChange) return;

    const newDays = specificDays.includes(day)
      ? specificDays.filter((d) => d !== day)
      : [...specificDays, day].sort((a, b) => a - b);

    // Don't allow empty selection
    if (newDays.length > 0) {
      onSpecificDaysChange(newDays);
    }
  };

  return (
    <div className="space-y-4">
      {/* Pattern Selection */}
      <div className="space-y-2">
        <Label>Recurrence Pattern</Label>
        <Select
          value={pattern}
          onValueChange={(value) => onPatternChange(value as RecurrencePattern)}
          disabled={disabled}
        >
          <SelectTrigger className={cn(compact && "h-9")}>
            <SelectValue placeholder="Select pattern" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(patternConfig) as RecurrencePattern[]).map((key) => {
              const config = patternConfig[key];
              const IconComponent = config.icon;
              return (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <IconComponent className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-medium">{config.label}</span>
                      {!compact && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({config.description})
                        </span>
                      )}
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Custom Weeks Input - for CUSTOM pattern */}
      {pattern === "CUSTOM" && (
        <div className="space-y-2 pl-4 border-l-2 border-muted">
          <Label htmlFor="customWeeks">Every how many weeks?</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Every</span>
            <Input
              id="customWeeks"
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
      )}

      {/* Specific Days Selection - for SPECIFIC_DAYS pattern */}
      {pattern === "SPECIFIC_DAYS" && (
        <div className="space-y-2 pl-4 border-l-2 border-muted">
          <Label>Select days of the week</Label>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Checkbox
                  id={`day-${index}`}
                  checked={specificDays.includes(index)}
                  onCheckedChange={() => handleSpecificDayToggle(index)}
                  disabled={disabled || (specificDays.length === 1 && specificDays.includes(index))}
                />
                <Label
                  htmlFor={`day-${index}`}
                  className={cn(
                    "text-sm cursor-pointer",
                    specificDays.includes(index) && "font-medium"
                  )}
                >
                  {label}
                </Label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Selected: {specificDays.map((d) => FULL_DAY_LABELS[d]).join(", ") || "None"}
          </p>
        </div>
      )}

      {/* Nth Weekday Selection - for NTH_WEEKDAY pattern */}
      {pattern === "NTH_WEEKDAY" && (
        <div className="space-y-3 pl-4 border-l-2 border-muted">
          <Label>Select which occurrence</Label>
          <div className="flex flex-wrap gap-3">
            <Select
              value={nthWeek?.toString() ?? "1"}
              onValueChange={(value) => onNthWeekChange?.(parseInt(value))}
              disabled={disabled}
            >
              <SelectTrigger className="w-[120px]">
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

            <Select
              value={dayOfWeek?.toString() ?? "0"}
              onValueChange={(value) => onDayOfWeekChange?.(parseInt(value))}
              disabled={disabled}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Which day" />
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
          <p className="text-xs text-muted-foreground">
            Repeats on the {WEEK_LABELS[(nthWeek ?? 1) - 1]} {FULL_DAY_LABELS[dayOfWeek ?? 0]} of each month
          </p>
        </div>
      )}

      {/* Day of Week Selection - for WEEKLY, BIWEEKLY, CUSTOM, MONTHLY */}
      {["WEEKLY", "BIWEEKLY", "CUSTOM", "MONTHLY"].includes(pattern) && (
        <div className="space-y-2 pl-4 border-l-2 border-muted">
          <Label>Day of the week</Label>
          <Select
            value={dayOfWeek?.toString() ?? "0"}
            onValueChange={(value) => onDayOfWeekChange?.(parseInt(value))}
            disabled={disabled}
          >
            <SelectTrigger className={cn("w-[180px]", compact && "h-9")}>
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
      )}
    </div>
  );
}

// Helper function to get a human-readable label for the current pattern configuration
export function getPatternSummary(
  pattern: RecurrencePattern,
  options?: {
    customWeeks?: number;
    specificDays?: number[];
    dayOfWeek?: number;
    nthWeek?: number;
  }
): string {
  const { customWeeks = 1, specificDays = [], dayOfWeek = 0, nthWeek = 1 } = options || {};

  switch (pattern) {
    case "DAILY":
      return "Every day";
    case "WEEKLY":
      return `Every ${FULL_DAY_LABELS[dayOfWeek]}`;
    case "BIWEEKLY":
      return `Every other ${FULL_DAY_LABELS[dayOfWeek]}`;
    case "MONTHLY":
      return `Monthly on ${FULL_DAY_LABELS[dayOfWeek]}s`;
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
