"use client";

import { format } from "date-fns";
import { RecurrenceEndType } from "@prisma/client";
import { CalendarX } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { chipClass } from "./chip";

interface EndConditionSelectorProps {
  endType: RecurrenceEndType;
  onEndTypeChange: (type: RecurrenceEndType) => void;
  endAfterCount?: number;
  onEndAfterCountChange?: (count: number) => void;
  endByDate?: Date;
  onEndByDateChange?: (date: Date | undefined) => void;
  disabled?: boolean;
  minDate?: Date;
}

const END_ORDER: RecurrenceEndType[] = ["NEVER", "AFTER_COUNT", "BY_DATE"];
const END_LABELS: Record<RecurrenceEndType, string> = {
  NEVER: "Never",
  AFTER_COUNT: "After…",
  BY_DATE: "On a date",
};

export function EndConditionSelector({
  endType,
  onEndTypeChange,
  endAfterCount = 12,
  onEndAfterCountChange,
  endByDate,
  onEndByDateChange,
  disabled = false,
  minDate = new Date(),
}: EndConditionSelectorProps) {
  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Series Ends
      </Label>

      {/* End-type chips */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When the series ends">
        {END_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={endType === key}
            disabled={disabled}
            onClick={() => onEndTypeChange(key)}
            className={chipClass(endType === key)}
          >
            {END_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Contextual field for the chosen end type */}
      <div className="mt-2 rounded-xl border bg-muted/40 p-4">
        {endType === "NEVER" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden>∞</span>
            <span>Continues until you cancel it. Appointments are generated a few months ahead.</span>
          </p>
        )}

        {endType === "AFTER_COUNT" && (
          <div className="space-y-2">
            <Label htmlFor="endAfterCount" className="text-xs font-medium">
              End after a set number of visits
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">After</span>
              <Input
                id="endAfterCount"
                type="number"
                min={1}
                max={365}
                value={endAfterCount}
                onChange={(e) => onEndAfterCountChange?.(parseInt(e.target.value) || 1)}
                className="w-24"
                disabled={disabled}
              />
              <span className="text-sm text-muted-foreground">appointment(s)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              The series stops automatically once this many visits are booked.
            </p>
          </div>
        )}

        {endType === "BY_DATE" && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Stop repeating on this date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal sm:max-w-[240px]",
                    !endByDate && "text-muted-foreground"
                  )}
                  disabled={disabled}
                >
                  <CalendarX className="mr-2 h-4 w-4" />
                  {endByDate ? format(endByDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endByDate}
                  onSelect={onEndByDateChange}
                  disabled={(date) =>
                    date < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {endByDate && (
              <p className="text-xs text-muted-foreground">
                Series will end on {format(endByDate, "EEEE, MMMM d, yyyy")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper function to get a human-readable summary of the end condition
export function getEndConditionSummary(
  endType: RecurrenceEndType,
  options?: {
    endAfterCount?: number;
    endByDate?: Date;
  }
): string {
  const { endAfterCount = 12, endByDate } = options || {};

  switch (endType) {
    case "NEVER":
      return "No end date";
    case "AFTER_COUNT":
      return `After ${endAfterCount} appointment${endAfterCount !== 1 ? "s" : ""}`;
    case "BY_DATE":
      return endByDate ? `Until ${format(endByDate, "MMM d, yyyy")}` : "End date not set";
    default:
      return endType;
  }
}
