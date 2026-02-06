"use client";

import { useState } from "react";
import { format, isBefore, startOfDay } from "date-fns";
import { toast } from "sonner";
import { CalendarOff, Plus, X, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ExceptionDate {
  id: string;
  date: Date;
  reason: string | null;
}

interface ExceptionDatesManagerProps {
  seriesId: string;
  exceptions: ExceptionDate[];
  onAddException: (date: Date, reason?: string) => Promise<{ success: boolean; error?: string }>;
  onRemoveException: (exceptionId: string) => Promise<{ success: boolean; error?: string }>;
  upcomingDates?: Date[]; // Dates when appointments will occur
  disabled?: boolean;
  compact?: boolean;
}

export function ExceptionDatesManager({
  seriesId,
  exceptions,
  onAddException,
  onRemoveException,
  upcomingDates = [],
  disabled = false,
  compact = false,
}: ExceptionDatesManagerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [reason, setReason] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const today = startOfDay(new Date());
  const exceptionDates = exceptions.map((e) => startOfDay(new Date(e.date)));

  const handleAddException = async () => {
    if (!selectedDate) return;

    setIsAdding(true);
    try {
      const result = await onAddException(selectedDate, reason || undefined);
      if (result.success) {
        toast.success(`Added exception for ${format(selectedDate, "PPP")}`);
        setSelectedDate(undefined);
        setReason("");
        setIsDatePickerOpen(false);
      } else {
        toast.error(result.error || "Failed to add exception");
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveException = async (exceptionId: string) => {
    setRemovingId(exceptionId);
    try {
      const result = await onRemoveException(exceptionId);
      if (result.success) {
        toast.success("Exception removed");
      } else {
        toast.error(result.error || "Failed to remove exception");
      }
    } finally {
      setRemovingId(null);
    }
  };

  // Sort exceptions by date, most recent first
  const sortedExceptions = [...exceptions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const futureExceptions = sortedExceptions.filter(
    (e) => !isBefore(new Date(e.date), today)
  );
  const pastExceptions = sortedExceptions.filter((e) =>
    isBefore(new Date(e.date), today)
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <CalendarOff className="h-4 w-4" />
            Skip Dates ({exceptions.length})
          </Label>
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                className="h-8"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => {
                  const dayStart = startOfDay(date);
                  // Disable past dates
                  if (isBefore(dayStart, today)) return true;
                  // Disable already excepted dates
                  if (exceptionDates.some((d) => d.getTime() === dayStart.getTime())) return true;
                  // If we have upcoming dates, only allow those
                  if (upcomingDates.length > 0) {
                    return !upcomingDates.some(
                      (d) => startOfDay(d).getTime() === dayStart.getTime()
                    );
                  }
                  return false;
                }}
                initialFocus
              />
              {selectedDate && (
                <div className="p-3 border-t space-y-2">
                  <Input
                    placeholder="Reason (optional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={isAdding}
                  />
                  <Button
                    size="sm"
                    onClick={handleAddException}
                    disabled={isAdding}
                    className="w-full"
                  >
                    {isAdding ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    Skip {format(selectedDate, "MMM d")}
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {futureExceptions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {futureExceptions.map((exception) => (
              <Badge
                key={exception.id}
                variant="secondary"
                className="text-xs flex items-center gap-1"
              >
                {format(new Date(exception.date), "MMM d")}
                {!disabled && (
                  <button
                    onClick={() => handleRemoveException(exception.id)}
                    disabled={removingId === exception.id}
                    className="hover:text-destructive"
                  >
                    {removingId === exception.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}

        {exceptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No dates are being skipped
          </p>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarOff className="h-4 w-4" />
          Exception Dates
        </CardTitle>
        <CardDescription>
          Skip specific dates in the recurring series
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Exception Form */}
        <div className="flex gap-2">
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "flex-1 justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
                disabled={disabled}
              >
                <CalendarOff className="mr-2 h-4 w-4" />
                {selectedDate ? format(selectedDate, "PPP") : "Select date to skip"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => {
                  const dayStart = startOfDay(date);
                  if (isBefore(dayStart, today)) return true;
                  if (exceptionDates.some((d) => d.getTime() === dayStart.getTime())) return true;
                  if (upcomingDates.length > 0) {
                    return !upcomingDates.some(
                      (d) => startOfDay(d).getTime() === dayStart.getTime()
                    );
                  }
                  return false;
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {selectedDate && (
          <div className="flex gap-2">
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isAdding || disabled}
              className="flex-1"
            />
            <Button
              onClick={handleAddException}
              disabled={isAdding || disabled}
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}

        {/* Exception List */}
        {exceptions.length > 0 ? (
          <ScrollArea className={cn(exceptions.length > 5 && "h-48")}>
            <div className="space-y-2">
              {futureExceptions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Upcoming Skipped Dates
                  </p>
                  {futureExceptions.map((exception) => (
                    <div
                      key={exception.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {format(new Date(exception.date), "EEEE, MMM d, yyyy")}
                        </p>
                        {exception.reason && (
                          <p className="text-xs text-muted-foreground">
                            {exception.reason}
                          </p>
                        )}
                      </div>
                      {!disabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveException(exception.id)}
                          disabled={removingId === exception.id}
                        >
                          {removingId === exception.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {pastExceptions.length > 0 && (
                <div className="space-y-1 opacity-60">
                  <p className="text-xs font-medium text-muted-foreground">
                    Past Skipped Dates
                  </p>
                  {pastExceptions.map((exception) => (
                    <div
                      key={exception.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md"
                    >
                      <div>
                        <p className="text-sm">
                          {format(new Date(exception.date), "MMM d, yyyy")}
                        </p>
                        {exception.reason && (
                          <p className="text-xs text-muted-foreground">
                            {exception.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No exception dates. All appointments in the series will be scheduled.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
