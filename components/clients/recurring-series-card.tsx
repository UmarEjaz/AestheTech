"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import { toast } from "sonner";
import { Repeat, Calendar, Clock, User, XCircle, Settings2, Download } from "lucide-react";
import { RecurrencePattern, RecurrenceEndType, AppointmentStatus } from "@prisma/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelRecurringSeries } from "@/lib/actions/recurring-series";
import { getPatternLabel } from "@/lib/utils/recurring";
import { SeriesManagementPanel } from "@/components/appointments/series-management-panel";

interface RecurringSeries {
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
    status: AppointmentStatus;
  }[];
}

interface RecurringSeriesCardProps {
  series: RecurringSeries[];
  clientId: string;
  canManage?: boolean;
  timezone: string;
}

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecurringSeriesCard({ series, clientId, canManage = false, timezone }: RecurringSeriesCardProps) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [managingSeries, setManagingSeries] = useState<RecurringSeries | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const activeSeries = series.filter((s) => s.isActive);
  const inactiveSeries = series.filter((s) => !s.isActive);

  const handleDataChange = () => {
    router.refresh();
    setManagingSeries(null);
  };

  const handleCancelSeries = async () => {
    if (!cancellingId) return;

    setIsUpdating(true);
    try {
      const result = await cancelRecurringSeries(cancellingId);
      if (result.success) {
        toast.success(`Cancelled ${result.data.cancelledCount} future appointments`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setCancellingId(null);
    }
  };

  if (series.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Repeat className="h-5 w-5" />
              Recurring Appointments
            </CardTitle>
            {activeSeries.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/api/ical/client/${clientId}`, "_blank")}
              >
                <Download className="h-4 w-4 mr-1" />
                Export All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active recurring appointments</p>
          ) : (
            activeSeries.map((s) => (
              <div key={s.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{s.service.name}</h4>
                      {s.isPaused && (
                        <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">
                        <Repeat className="h-3 w-3 mr-1" />
                        {getPatternLabel(s.pattern, { customWeeks: s.customWeeks })}
                      </Badge>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setManagingSeries(s)}
                      >
                        <Settings2 className="h-4 w-4 mr-1" />
                        Manage
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive hover:bg-destructive/10"
                        onClick={() => setCancellingId(s.id)}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {dayNames[s.dayOfWeek]}s at {formatInTz(new Date(`2000-01-01T${s.timeOfDay}`), "h:mm a", "UTC")}
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {s.staff.firstName} {s.staff.lastName}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {s.service.duration} minutes
                  </div>
                </div>

                {s.appointments.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Upcoming Appointments
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {s.appointments.map((apt) => (
                        <Badge key={apt.id} variant="outline" className="text-xs">
                          {formatInTz(apt.startTime, "MMM d", timezone)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {inactiveSeries.length > 0 && (
            <div className="pt-4 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Cancelled Series ({inactiveSeries.length})
              </p>
              <div className="space-y-2">
                {inactiveSeries.slice(0, 3).map((s) => (
                  <div key={s.id} className="text-sm text-muted-foreground flex items-center gap-2">
                    <span className="line-through">{s.service.name}</span>
                    <span className="text-xs">
                      ({getPatternLabel(s.pattern, { customWeeks: s.customWeeks })})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!cancellingId} onOpenChange={() => setCancellingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Recurring Series?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel all future appointments in this recurring series. Past and completed
              appointments will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep series</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSeries}
              disabled={isUpdating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Series Management Dialog */}
      <Dialog open={!!managingSeries} onOpenChange={() => setManagingSeries(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Recurring Series</DialogTitle>
          </DialogHeader>
          {managingSeries && (
            <SeriesManagementPanel
              series={{
                id: managingSeries.id,
                pattern: managingSeries.pattern,
                customWeeks: managingSeries.customWeeks,
                dayOfWeek: managingSeries.dayOfWeek,
                timeOfDay: managingSeries.timeOfDay,
                specificDays: managingSeries.specificDays,
                nthWeek: managingSeries.nthWeek,
                endType: managingSeries.endType,
                endAfterCount: managingSeries.endAfterCount,
                endByDate: managingSeries.endByDate,
                occurrencesCreated: managingSeries.occurrencesCreated,
                isPaused: managingSeries.isPaused,
                pausedAt: managingSeries.pausedAt,
                pausedUntil: managingSeries.pausedUntil,
                isActive: managingSeries.isActive,
                notes: managingSeries.notes,
                service: managingSeries.service,
                staff: managingSeries.staff,
                client: managingSeries.client,
                exceptions: managingSeries.exceptions,
                appointments: managingSeries.appointments.map((apt) => ({
                  ...apt,
                  status: apt.status as string,
                })),
              }}
              onDataChange={handleDataChange}
              timezone={timezone}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
