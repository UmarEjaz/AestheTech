"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMonths } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
import { toast } from "sonner";
import {
  Repeat,
  Pause,
  Play,
  Plus,
  Copy,
  XCircle,
  Calendar,
  Clock,
  User,
  Scissors,
  CalendarOff,
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import { RecurrencePattern, RecurrenceEndType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getPatternLabel } from "@/lib/utils/recurring";
import { RecurringSeriesBadge } from "./recurring-series-badge";
import { ExceptionDatesManager } from "./exception-dates-manager";
import {
  pauseSeries,
  resumeSeries,
  extendSeries,
  cloneSeries,
  cancelRecurringSeries,
  addExceptionDate,
  removeExceptionDate,
} from "@/lib/actions/recurring-series";

interface SeriesDetails {
  id: string;
  pattern: RecurrencePattern;
  customWeeks: number | null;
  dayOfWeek: number;
  timeOfDay: string;
  specificDays: number[];
  nthWeek: number | null;
  endType: RecurrenceEndType;
  endAfterCount: number | null;
  endByDate: Date | null;
  occurrencesCreated: number;
  isPaused: boolean;
  pausedAt: Date | null;
  pausedUntil: Date | null;
  isActive: boolean;
  notes: string | null;
  service: {
    name: string;
    duration: number;
  };
  staff: {
    firstName: string;
    lastName: string;
  };
  client: {
    firstName: string;
    lastName: string | null;
  };
  exceptions: {
    id: string;
    date: Date;
    reason: string | null;
  }[];
  appointments: {
    id: string;
    startTime: Date;
    status: string;
  }[];
}

interface SeriesManagementPanelProps {
  series: SeriesDetails;
  onDataChange?: () => void;
  compact?: boolean;
  timezone: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SeriesManagementPanel({
  series,
  onDataChange,
  compact = false,
  timezone,
}: SeriesManagementPanelProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [isUpdating, setIsUpdating] = useState(false);

  // Dialog states
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Pause dialog state
  const [pauseUntil, setPauseUntil] = useState<Date | undefined>(
    addMonths(new Date(), 1)
  );

  // Extend dialog state
  const [extendMonths, setExtendMonths] = useState(3);

  const upcomingAppointments = series.appointments
    .filter((a) => new Date(a.startTime) > new Date() && a.status !== "CANCELLED")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const handlePause = async () => {
    setIsUpdating(true);
    try {
      const result = await pauseSeries({ seriesId: series.id, pausedUntil: pauseUntil });
      if (result.success) {
        toast.success(
          pauseUntil
            ? `Series paused until ${formatInTz(pauseUntil, "PPP", timezone)}`
            : "Series paused indefinitely"
        );
        onDataChange?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowPauseDialog(false);
    }
  };

  const handleResume = async () => {
    setIsUpdating(true);
    try {
      const result = await resumeSeries(series.id);
      if (result.success) {
        toast.success("Series resumed");
        onDataChange?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExtend = async () => {
    setIsUpdating(true);
    try {
      const result = await extendSeries({ seriesId: series.id, additionalMonths: extendMonths });
      if (result.success) {
        toast.success(`Series extended - ${result.data.createdCount} new appointments created`);
        onDataChange?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowExtendDialog(false);
    }
  };

  const handleClone = async () => {
    setIsUpdating(true);
    try {
      const result = await cloneSeries({ seriesId: series.id });
      if (result.success) {
        toast.success("Series cloned successfully");
        onDataChange?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowCloneDialog(false);
    }
  };

  const handleCancel = async () => {
    setIsUpdating(true);
    try {
      const result = await cancelRecurringSeries(series.id);
      if (result.success) {
        toast.success(`Series cancelled - ${result.data.cancelledCount} appointments cancelled`);
        onDataChange?.();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowCancelDialog(false);
    }
  };

  const handleAddException = async (date: Date, reason?: string) => {
    const result = await addExceptionDate({ seriesId: series.id, date, reason });
    if (result.success) {
      onDataChange?.();
      router.refresh();
    }
    return result;
  };

  const handleRemoveException = async (exceptionId: string) => {
    const result = await removeExceptionDate(exceptionId);
    if (result.success) {
      onDataChange?.();
      router.refresh();
    }
    return result;
  };

  if (compact) {
    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <Card>
          <CardHeader className="pb-2">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer">
                <CardTitle className="text-base flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Recurring Series
                </CardTitle>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </CollapsibleTrigger>
            <div className="flex items-center gap-2 pt-1">
              <RecurringSeriesBadge
                pattern={series.pattern}
                customWeeks={series.customWeeks}
                isActive={series.isActive}
                isPaused={series.isPaused}
              />
              {!series.isActive && (
                <Badge variant="destructive" className="text-xs">
                  Cancelled
                </Badge>
              )}
              {series.isPaused && (
                <Badge variant="secondary" className="text-xs">
                  Paused
                </Badge>
              )}
            </div>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="pt-2 space-y-4">
              {/* Quick Actions */}
              {series.isActive && (
                <div className="flex flex-wrap gap-2">
                  {series.isPaused ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleResume}
                      disabled={isUpdating}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPauseDialog(true)}
                      disabled={isUpdating}
                    >
                      <Pause className="h-3 w-3 mr-1" />
                      Pause
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowExtendDialog(true)}
                    disabled={isUpdating || series.isPaused}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Extend
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCancelDialog(true)}
                    disabled={isUpdating}
                    className="text-destructive border-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Cancel Series
                  </Button>
                </div>
              )}

              {/* Exception Dates - Compact */}
              <ExceptionDatesManager
                seriesId={series.id}
                exceptions={series.exceptions}
                onAddException={handleAddException}
                onRemoveException={handleRemoveException}
                upcomingDates={upcomingAppointments.map((a) => new Date(a.startTime))}
                disabled={!series.isActive || isUpdating}
                compact
              />

              {/* Upcoming Appointments Preview */}
              {upcomingAppointments.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Next {Math.min(3, upcomingAppointments.length)} appointments
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {upcomingAppointments.slice(0, 3).map((apt) => (
                      <Badge key={apt.id} variant="outline" className="text-xs">
                        {formatInTz(apt.startTime, "MMM d", timezone)}
                      </Badge>
                    ))}
                    {upcomingAppointments.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{upcomingAppointments.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>

        {/* Dialogs */}
        {renderDialogs()}
      </Collapsible>
    );
  }

  // Full panel view
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                Recurring Series Details
              </CardTitle>
              <CardDescription>
                Manage this recurring appointment series
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <RecurringSeriesBadge
                pattern={series.pattern}
                customWeeks={series.customWeeks}
                isActive={series.isActive}
                isPaused={series.isPaused}
                showLabel
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Series Info */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Scissors className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{series.service.name}</span>
                <span className="text-muted-foreground">
                  ({series.service.duration} min)
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>
                  {series.staff.firstName} {series.staff.lastName}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{getPatternLabel(series.pattern, { customWeeks: series.customWeeks })}</span>
                {series.pattern !== "SPECIFIC_DAYS" &&
                  series.pattern !== "DAILY" && (
                    <span className="text-muted-foreground">
                      on {DAY_LABELS[series.dayOfWeek]}s
                    </span>
                  )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>
                  {formatInTz(new Date(`2000-01-01T${series.timeOfDay}`), "h:mm a", "UTC")}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Status: </span>
                {!series.isActive ? (
                  <span className="text-destructive font-medium">Cancelled</span>
                ) : series.isPaused ? (
                  <span className="text-yellow-600 font-medium">
                    Paused
                    {series.pausedUntil &&
                      ` until ${formatInTz(series.pausedUntil, "MMM d, yyyy", timezone)}`}
                  </span>
                ) : (
                  <span className="text-green-600 font-medium">Active</span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Appointments created: </span>
                <span>{series.occurrencesCreated}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Upcoming: </span>
                <span>{upcomingAppointments.length}</span>
              </div>
              {series.endType !== "NEVER" && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Ends: </span>
                  {series.endType === "AFTER_COUNT" && (
                    <span>After {series.endAfterCount} occurrences</span>
                  )}
                  {series.endType === "BY_DATE" && series.endByDate && (
                    <span>{formatInTz(series.endByDate, "MMM d, yyyy", timezone)}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {series.isActive && (
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              {series.isPaused ? (
                <Button
                  variant="outline"
                  onClick={handleResume}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Resume Series
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowPauseDialog(true)}
                  disabled={isUpdating}
                >
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Series
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowExtendDialog(true)}
                disabled={isUpdating || series.isPaused}
              >
                <Plus className="h-4 w-4 mr-2" />
                Extend Series
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCloneDialog(true)}
                disabled={isUpdating}
              >
                <Copy className="h-4 w-4 mr-2" />
                Clone Series
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(`/api/ical/series/${series.id}`, "_blank")}
                disabled={isUpdating}
              >
                <Download className="h-4 w-4 mr-2" />
                Export to Calendar
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                disabled={isUpdating}
                className="text-destructive border-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Cancel Series
              </Button>
            </div>
          )}

          {/* Exception Dates Manager */}
          <ExceptionDatesManager
            seriesId={series.id}
            exceptions={series.exceptions}
            onAddException={handleAddException}
            onRemoveException={handleRemoveException}
            upcomingDates={upcomingAppointments.map((a) => new Date(a.startTime))}
            disabled={!series.isActive || isUpdating}
          />

          {/* Upcoming Appointments */}
          {upcomingAppointments.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Upcoming Appointments
              </h4>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {upcomingAppointments.slice(0, 6).map((apt) => (
                  <div
                    key={apt.id}
                    className="text-sm p-2 rounded-md bg-muted/50"
                  >
                    <p className="font-medium">
                      {formatInTz(apt.startTime, "EEEE, MMM d", timezone)}
                    </p>
                    <p className="text-muted-foreground">
                      {formatInTz(apt.startTime, "h:mm a", timezone)}
                    </p>
                  </div>
                ))}
              </div>
              {upcomingAppointments.length > 6 && (
                <p className="text-sm text-muted-foreground">
                  +{upcomingAppointments.length - 6} more appointments
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {renderDialogs()}
    </>
  );

  function renderDialogs() {
    return (
      <>
        {/* Pause Dialog */}
        <AlertDialog open={showPauseDialog} onOpenChange={setShowPauseDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Pause Recurring Series?</AlertDialogTitle>
              <AlertDialogDescription>
                New appointments won&apos;t be generated while the series is paused.
                Existing appointments will not be affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-4">
              <Label>Resume automatically on (optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal mt-2",
                      !pauseUntil && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {pauseUntil
                      ? formatInTz(pauseUntil, "PPP", timezone)
                      : "No auto-resume date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={pauseUntil}
                    onSelect={setPauseUntil}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setPauseUntil(undefined)}
              >
                Clear date (pause indefinitely)
              </Button>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handlePause} disabled={isUpdating}>
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Pause className="h-4 w-4 mr-2" />
                )}
                Pause Series
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Extend Dialog */}
        <AlertDialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Extend Recurring Series</AlertDialogTitle>
              <AlertDialogDescription>
                Generate more appointments for this recurring series.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-4 space-y-2">
              <Label>Extend by</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={extendMonths}
                  onChange={(e) => setExtendMonths(parseInt(e.target.value) || 1)}
                  className="w-20"
                />
                <span className="text-muted-foreground">months</span>
              </div>
              <p className="text-xs text-muted-foreground">
                New appointments will be created if slots are available.
              </p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleExtend} disabled={isUpdating}>
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Extend Series
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clone Dialog */}
        <AlertDialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clone Recurring Series</AlertDialogTitle>
              <AlertDialogDescription>
                Create a new recurring series with the same settings for{" "}
                {series.client.firstName} {series.client.lastName}. The new series
                will start generating appointments from today.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClone} disabled={isUpdating}>
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Clone Series
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Cancel Dialog */}
        <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Recurring Series?</AlertDialogTitle>
              <AlertDialogDescription>
                This will cancel all future appointments in the series for{" "}
                {series.client.firstName} {series.client.lastName}. Past and
                completed appointments will not be affected. This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Series</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancel}
                disabled={isUpdating}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                Cancel Series
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
}
