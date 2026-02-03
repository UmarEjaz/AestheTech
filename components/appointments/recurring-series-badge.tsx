"use client";

import { Repeat, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RecurrencePattern } from "@prisma/client";

interface RecurringSeriesBadgeProps {
  pattern: RecurrencePattern;
  customWeeks?: number | null;
  isActive?: boolean;
  isPaused?: boolean;
  showLabel?: boolean;
  className?: string;
}

function getPatternLabel(pattern: RecurrencePattern, customWeeks?: number | null): string {
  switch (pattern) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "BIWEEKLY":
      return "Every 2 weeks";
    case "MONTHLY":
      return "Monthly";
    case "CUSTOM":
      return `Every ${customWeeks || 1} week${(customWeeks || 1) > 1 ? "s" : ""}`;
    case "SPECIFIC_DAYS":
      return "Specific days";
    case "NTH_WEEKDAY":
      return "Nth weekday";
    default:
      return pattern;
  }
}

export function RecurringSeriesBadge({
  pattern,
  customWeeks,
  isActive = true,
  isPaused = false,
  showLabel = false,
  className,
}: RecurringSeriesBadgeProps) {
  const label = getPatternLabel(pattern, customWeeks);

  const getStatusSuffix = () => {
    if (!isActive) return " (Cancelled)";
    if (isPaused) return " (Paused)";
    return "";
  };

  const getVariant = () => {
    if (!isActive) return "outline";
    if (isPaused) return "secondary";
    return "secondary";
  };

  const Icon = isPaused ? Pause : Repeat;

  if (showLabel) {
    return (
      <Badge
        variant={getVariant()}
        className={className}
      >
        <Icon className="h-3 w-3 mr-1" />
        {label}
        {getStatusSuffix()}
      </Badge>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={getVariant()}
            className={`cursor-help ${className}`}
          >
            <Icon className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Recurring: {label}
            {getStatusSuffix()}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
