"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Calendar, Clock, Check, X, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface ConflictDate {
  date: Date;
  reason: string;
  alternatives?: AlternativeSlot[];
}

export interface AlternativeSlot {
  date: Date;
  startTime: Date;
  endTime: Date;
  staffId: string;
  staffName: string;
}

export interface SelectedAlternative {
  originalDate: Date;
  alternative: AlternativeSlot;
}

interface ConflictResolutionUIProps {
  conflicts: ConflictDate[];
  onSelectAlternative?: (originalDate: Date, alternative: AlternativeSlot) => void;
  onSkipDate?: (date: Date) => void;
  selectedAlternatives?: SelectedAlternative[];
  skippedDates?: Date[];
  compact?: boolean;
  showAllDates?: boolean;
}

export function ConflictResolutionUI({
  conflicts,
  onSelectAlternative,
  onSkipDate,
  selectedAlternatives = [],
  skippedDates = [],
  compact = false,
  showAllDates = false,
}: ConflictResolutionUIProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  if (conflicts.length === 0) {
    return null;
  }

  const toggleExpanded = (dateKey: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(dateKey)) {
      newExpanded.delete(dateKey);
    } else {
      newExpanded.add(dateKey);
    }
    setExpandedDates(newExpanded);
  };

  const getDateKey = (date: Date) => format(date, "yyyy-MM-dd");

  const isDateSkipped = (date: Date) =>
    skippedDates.some((d) => getDateKey(d) === getDateKey(date));

  const getSelectedAlternative = (date: Date) =>
    selectedAlternatives.find((sa) => getDateKey(sa.originalDate) === getDateKey(date));

  const visibleConflicts = showAllDates ? conflicts : conflicts.slice(0, 5);
  const hasMoreConflicts = !showAllDates && conflicts.length > 5;

  if (compact) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 p-3 space-y-2">
        <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">
            {conflicts.length} scheduling conflict{conflicts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-xs text-yellow-700 dark:text-yellow-300">
          Some dates have conflicts. You can select alternative times or skip these dates.
        </p>
        <div className="flex flex-wrap gap-1">
          {visibleConflicts.map((conflict) => {
            const dateKey = getDateKey(conflict.date);
            const isSkipped = isDateSkipped(conflict.date);
            const selected = getSelectedAlternative(conflict.date);

            return (
              <Badge
                key={dateKey}
                variant={isSkipped ? "destructive" : selected ? "default" : "secondary"}
                className={cn(
                  "text-xs",
                  isSkipped && "line-through opacity-60"
                )}
              >
                {format(conflict.date, "MMM d")}
                {selected && <Check className="h-3 w-3 ml-1" />}
                {isSkipped && <X className="h-3 w-3 ml-1" />}
              </Badge>
            );
          })}
          {hasMoreConflicts && (
            <Badge variant="outline" className="text-xs">
              +{conflicts.length - 5} more
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/10 dark:border-yellow-900">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="h-5 w-5" />
          Scheduling Conflicts ({conflicts.length})
        </CardTitle>
        <CardDescription className="text-yellow-700 dark:text-yellow-300">
          The following dates have conflicts. Select alternative times or skip these dates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className={cn(conflicts.length > 4 && "h-[300px]")}>
          <div className="space-y-2">
            {visibleConflicts.map((conflict) => {
              const dateKey = getDateKey(conflict.date);
              const isExpanded = expandedDates.has(dateKey);
              const isSkipped = isDateSkipped(conflict.date);
              const selected = getSelectedAlternative(conflict.date);
              const hasAlternatives = conflict.alternatives && conflict.alternatives.length > 0;

              return (
                <Collapsible
                  key={dateKey}
                  open={isExpanded}
                  onOpenChange={() => toggleExpanded(dateKey)}
                >
                  <div
                    className={cn(
                      "rounded-lg border p-3",
                      isSkipped && "opacity-60 bg-muted",
                      selected && "border-green-300 bg-green-50 dark:bg-green-950/20"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span
                            className={cn(
                              "font-medium",
                              isSkipped && "line-through"
                            )}
                          >
                            {format(conflict.date, "EEEE, MMM d, yyyy")}
                          </span>
                        </div>
                        {isSkipped && (
                          <Badge variant="destructive" className="text-xs">
                            Skipped
                          </Badge>
                        )}
                        {selected && (
                          <Badge variant="default" className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Alternative selected
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isSkipped && !selected && onSkipDate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSkipDate(conflict.date);
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Skip
                          </Button>
                        )}
                        {hasAlternatives && !isSkipped && (
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm">
                              {conflict.alternatives!.length} alternative
                              {conflict.alternatives!.length !== 1 ? "s" : ""}
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 ml-1" />
                              ) : (
                                <ChevronDown className="h-4 w-4 ml-1" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mt-1">
                      {conflict.reason}
                    </p>

                    {selected && (
                      <div className="mt-2 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        Rescheduled to {format(selected.alternative.startTime, "h:mm a")} with{" "}
                        {selected.alternative.staffName}
                      </div>
                    )}

                    <CollapsibleContent>
                      {hasAlternatives && !isSkipped && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Available alternatives:
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {conflict.alternatives!.map((alt, index) => {
                              const isSelected =
                                selected?.alternative.startTime.getTime() ===
                                alt.startTime.getTime();

                              return (
                                <Button
                                  key={index}
                                  variant={isSelected ? "default" : "outline"}
                                  size="sm"
                                  className={cn(
                                    "justify-start h-auto py-2",
                                    isSelected && "ring-2 ring-green-500"
                                  )}
                                  onClick={() =>
                                    onSelectAlternative?.(conflict.date, alt)
                                  }
                                >
                                  <div className="text-left">
                                    <div className="flex items-center gap-2">
                                      <Clock className="h-3 w-3" />
                                      {format(alt.startTime, "h:mm a")} -{" "}
                                      {format(alt.endTime, "h:mm a")}
                                      {isSelected && (
                                        <Check className="h-3 w-3 ml-auto" />
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      with {alt.staffName}
                                    </p>
                                  </div>
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>

        {hasMoreConflicts && (
          <p className="text-sm text-muted-foreground text-center mt-3">
            +{conflicts.length - 5} more conflicts
          </p>
        )}

        {/* Summary */}
        <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
          <div className="space-x-4">
            <span className="text-muted-foreground">
              Resolved:{" "}
              <span className="font-medium text-foreground">
                {selectedAlternatives.length}
              </span>
            </span>
            <span className="text-muted-foreground">
              Skipped:{" "}
              <span className="font-medium text-foreground">
                {skippedDates.length}
              </span>
            </span>
            <span className="text-muted-foreground">
              Remaining:{" "}
              <span className="font-medium text-foreground">
                {conflicts.length - selectedAlternatives.length - skippedDates.length}
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper to create a preview of conflict resolution results
export function ConflictSummary({
  totalDates,
  successfulDates,
  conflictDates,
  skippedDates,
}: {
  totalDates: number;
  successfulDates: number;
  conflictDates: number;
  skippedDates: number;
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span>{successfulDates} scheduled</span>
      </div>
      {conflictDates > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <span>{conflictDates} conflicts</span>
        </div>
      )}
      {skippedDates > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span>{skippedDates} skipped</span>
        </div>
      )}
    </div>
  );
}
