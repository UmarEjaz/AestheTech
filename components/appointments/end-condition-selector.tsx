"use client";

import { format } from "date-fns";
import { RecurrenceEndType } from "@prisma/client";
import { Infinity, Hash, CalendarX } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface EndConditionSelectorProps {
  endType: RecurrenceEndType;
  onEndTypeChange: (type: RecurrenceEndType) => void;
  endAfterCount?: number;
  onEndAfterCountChange?: (count: number) => void;
  endByDate?: Date;
  onEndByDateChange?: (date: Date | undefined) => void;
  disabled?: boolean;
  compact?: boolean;
  minDate?: Date;
}

const endTypeConfig: Record<
  RecurrenceEndType,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  NEVER: {
    label: "Never",
    description: "Continues indefinitely",
    icon: Infinity,
  },
  AFTER_COUNT: {
    label: "After",
    description: "After N occurrences",
    icon: Hash,
  },
  BY_DATE: {
    label: "On Date",
    description: "End by specific date",
    icon: CalendarX,
  },
};

export function EndConditionSelector({
  endType,
  onEndTypeChange,
  endAfterCount = 12,
  onEndAfterCountChange,
  endByDate,
  onEndByDateChange,
  disabled = false,
  compact = false,
  minDate = new Date(),
}: EndConditionSelectorProps) {
  return (
    <div className="space-y-4">
      {/* End Type Selection */}
      <div className="space-y-2">
        <Label>Series Ends</Label>
        <Select
          value={endType}
          onValueChange={(value) => onEndTypeChange(value as RecurrenceEndType)}
          disabled={disabled}
        >
          <SelectTrigger className={cn(compact && "h-9")}>
            <SelectValue placeholder="Select end condition" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(endTypeConfig) as RecurrenceEndType[]).map((key) => {
              const config = endTypeConfig[key];
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

      {/* After Count Input */}
      {endType === "AFTER_COUNT" && (
        <div className="space-y-2 pl-4 border-l-2 border-muted">
          <Label htmlFor="endAfterCount">Number of occurrences</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">After</span>
            <Input
              id="endAfterCount"
              type="number"
              min={1}
              max={365}
              value={endAfterCount}
              onChange={(e) => onEndAfterCountChange?.(parseInt(e.target.value) || 1)}
              className="w-20"
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">appointment(s)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Series will automatically end after {endAfterCount} scheduled appointment{endAfterCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* End By Date Picker */}
      {endType === "BY_DATE" && (
        <div className="space-y-2 pl-4 border-l-2 border-muted">
          <Label>End date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !endByDate && "text-muted-foreground",
                  compact && "h-9"
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
                disabled={(date) => date < minDate}
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

      {/* Never ends info */}
      {endType === "NEVER" && (
        <div className="pl-4 border-l-2 border-muted">
          <p className="text-xs text-muted-foreground">
            Appointments will be generated for the next 3 months. The series can be cancelled or paused at any time.
          </p>
        </div>
      )}
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
