"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Plus,
  Edit,
  Trash2,
  Check,
  X,
  Copy,
  Users,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { ShiftType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteSchedule,
  createSchedule,
  updateSchedule,
  toggleScheduleAvailability,
  copySchedule,
  setWeekSchedule,
} from "@/lib/actions/schedule";
import { Switch } from "@/components/ui/switch";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface Schedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  isAvailable: boolean;
}

interface StaffWithSchedules {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roleLabel?: string;
  schedules: Schedule[];
}

interface ScheduleWeekViewProps {
  staffWithSchedules: StaffWithSchedules[];
  canManage: boolean;
}

const SHIFT_COLORS: Record<ShiftType, string> = {
  OPENING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  CLOSING: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  REGULAR: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  SPLIT: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

export function ScheduleWeekView({ staffWithSchedules, canManage }: ScheduleWeekViewProps) {
  const router = useRouter();
  const [editingSchedule, setEditingSchedule] = useState<{
    staffId: string;
    dayOfWeek: number;
    schedule?: Schedule;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copyDialog, setCopyDialog] = useState<{ fromStaffId: string; fromName: string } | null>(null);
  const [copyToStaffId, setCopyToStaffId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bulk week schedule state
  type ShiftEntry = { startTime: string; endTime: string; shiftType: ShiftType };
  type DayEntry = { enabled: boolean; shifts: ShiftEntry[] };
  const defaultShift = (): ShiftEntry => ({
    startTime: "09:00",
    endTime: "17:00",
    shiftType: ShiftType.REGULAR,
  });
  const [weekDialog, setWeekDialog] = useState<{ staffId: string; staffName: string } | null>(null);
  const [weekDays, setWeekDays] = useState<DayEntry[]>(() =>
    DAY_NAMES.map(() => ({ enabled: false, shifts: [defaultShift()] }))
  );

  // Form state
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [shiftType, setShiftType] = useState<ShiftType>(ShiftType.REGULAR);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
  };

  const openEditDialog = (staffId: string, dayOfWeek: number, schedule?: Schedule) => {
    if (schedule) {
      setStartTime(schedule.startTime);
      setEndTime(schedule.endTime);
      setShiftType(schedule.shiftType);
    } else {
      setStartTime("09:00");
      setEndTime("17:00");
      setShiftType(ShiftType.REGULAR);
    }
    setEditingSchedule({ staffId, dayOfWeek, schedule });
  };

  const handleSaveSchedule = async () => {
    if (!editingSchedule) return;

    setIsSubmitting(true);
    try {
      const data = {
        staffId: editingSchedule.staffId,
        dayOfWeek: editingSchedule.dayOfWeek,
        startTime,
        endTime,
        shiftType,
        isAvailable: true,
      };

      let result;
      if (editingSchedule.schedule) {
        result = await updateSchedule(editingSchedule.schedule.id, data);
      } else {
        result = await createSchedule(data);
      }

      if (result.success) {
        toast.success(editingSchedule.schedule ? "Schedule updated" : "Schedule created");
        setEditingSchedule(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    const result = await deleteSchedule(deleteId);
    if (result.success) {
      toast.success("Schedule deleted");
      setDeleteId(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const handleToggleAvailability = async (id: string) => {
    const result = await toggleScheduleAvailability(id);
    if (result.success) {
      toast.success("Availability toggled");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const handleCopySchedule = async () => {
    if (!copyDialog || !copyToStaffId) return;

    setIsSubmitting(true);
    try {
      const result = await copySchedule(copyDialog.fromStaffId, copyToStaffId);
      if (result.success) {
        toast.success("Schedule copied successfully");
        setCopyDialog(null);
        setCopyToStaffId("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const openWeekDialog = (staff: StaffWithSchedules) => {
    const days: DayEntry[] = DAY_NAMES.map((_, dayIndex) => {
      const shifts = staff.schedules
        .filter((s) => s.dayOfWeek === dayIndex)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map<ShiftEntry>((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          shiftType: s.shiftType,
        }));
      if (shifts.length > 0) {
        return { enabled: true, shifts };
      }
      return { enabled: false, shifts: [defaultShift()] };
    });
    setWeekDays(days);
    setWeekDialog({ staffId: staff.id, staffName: `${staff.firstName} ${staff.lastName}` });
  };

  const setDayEnabled = (dayIndex: number, enabled: boolean) => {
    setWeekDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIndex) return d;
        // When enabling a day with no shifts, seed a default shift
        const shifts = enabled && d.shifts.length === 0 ? [defaultShift()] : d.shifts;
        return { ...d, enabled, shifts };
      })
    );
  };

  const addShift = (dayIndex: number) => {
    setWeekDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIndex) return d;
        // Auto-relabel: a day becoming multi-shift can no longer carry "Regular" labels
        // (Regular means "the one continuous shift that day"). Opening/Closing/Split stay.
        const relabeledExisting = d.shifts.map((s) =>
          s.shiftType === ShiftType.REGULAR ? { ...s, shiftType: ShiftType.SPLIT } : s
        );
        const newShift: ShiftEntry = { ...defaultShift(), shiftType: ShiftType.SPLIT };
        return { ...d, shifts: [...relabeledExisting, newShift] };
      })
    );
  };

  const removeShift = (dayIndex: number, shiftIndex: number) => {
    setWeekDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIndex) return d;
        const nextShifts = d.shifts.filter((_, si) => si !== shiftIndex);
        // Removing the last shift auto-unchecks the day; reseed a default so re-enable works
        if (nextShifts.length === 0) {
          return { ...d, enabled: false, shifts: [defaultShift()] };
        }
        // Auto-relabel: if exactly one Split shift remains, flip it back to Regular
        // (it's no longer "part of a split" — it's the day's only shift now).
        // Opening/Closing labels are preserved (user picked them explicitly).
        if (nextShifts.length === 1 && nextShifts[0].shiftType === ShiftType.SPLIT) {
          return { ...d, shifts: [{ ...nextShifts[0], shiftType: ShiftType.REGULAR }] };
        }
        return { ...d, shifts: nextShifts };
      })
    );
  };

  const updateShift = (dayIndex: number, shiftIndex: number, updates: Partial<ShiftEntry>) => {
    setWeekDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIndex) return d;
        return {
          ...d,
          shifts: d.shifts.map((s, si) => (si === shiftIndex ? { ...s, ...updates } : s)),
        };
      })
    );
  };

  const applyToWeekdays = () => {
    const monday = weekDays[1];
    setWeekDays((prev) =>
      prev.map((d, i) =>
        i >= 1 && i <= 5
          ? {
              ...d,
              enabled: monday.enabled,
              shifts: monday.shifts.map((s) => ({ ...s })),
            }
          : d
      )
    );
  };

  // Convert "HH:mm" to minutes since midnight for overlap checks
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  // Per-day client-side overlap detection. Returns an array of error messages indexed by day.
  const dayOverlapErrors: (string | null)[] = weekDays.map((day) => {
    if (!day.enabled || day.shifts.length < 2) return null;
    for (let i = 0; i < day.shifts.length; i++) {
      const a = day.shifts[i];
      const aStart = toMinutes(a.startTime);
      const aEnd = toMinutes(a.endTime);
      if (aEnd <= aStart) {
        return "End time must be after start time";
      }
      for (let j = i + 1; j < day.shifts.length; j++) {
        const b = day.shifts[j];
        const bStart = toMinutes(b.startTime);
        const bEnd = toMinutes(b.endTime);
        if (aStart < bEnd && aEnd > bStart) {
          return "Shifts overlap";
        }
      }
    }
    return null;
  });
  const hasAnyOverlap = dayOverlapErrors.some((e) => e !== null);

  const handleSaveWeekSchedule = async () => {
    if (!weekDialog) return;

    const schedules = weekDays.flatMap((day, index) =>
      day.enabled
        ? day.shifts.map((shift) => ({
            dayOfWeek: index,
            startTime: shift.startTime,
            endTime: shift.endTime,
            shiftType: shift.shiftType,
            isAvailable: true,
          }))
        : []
    );

    setIsSubmitting(true);
    try {
      const result = await setWeekSchedule({ staffId: weekDialog.staffId, schedules });
      if (result.success) {
        toast.success("Week schedule saved");
        setWeekDialog(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
  };

  const getSchedulesForDay = (staff: StaffWithSchedules, dayOfWeek: number) => {
    return staff.schedules
      .filter((s) => s.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Total Staff</p>
                <p className="text-2xl font-bold">{staffWithSchedules.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium">Total Shifts</p>
                <p className="text-2xl font-bold">
                  {staffWithSchedules.reduce((sum, s) => sum + s.schedules.length, 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Schedule Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Schedule</CardTitle>
          <CardDescription>
            Staff working hours for each day of the week
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left font-medium w-48">Staff</th>
                {DAY_NAMES.map((day, index) => (
                  <th key={index} className="p-3 text-center font-medium min-w-[100px]">
                    {day.slice(0, 3)}
                  </th>
                ))}
                {canManage && <th className="p-3 text-center w-16">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {staffWithSchedules.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No staff members found</h3>
                    <p className="text-muted-foreground">
                      Add staff members to manage their schedules
                    </p>
                  </td>
                </tr>
              ) : (
                staffWithSchedules.map((staff) => (
                  <tr key={staff.id} className="border-b hover:bg-muted/50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-purple-100 text-purple-600 text-xs">
                            {getInitials(staff.firstName, staff.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">
                            {staff.firstName} {staff.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {staff.roleLabel || staff.role.toLowerCase().replaceAll("_", " ")}
                          </p>
                        </div>
                      </div>
                    </td>
                    {DAY_NAMES.map((_, dayIndex) => {
                      const daySchedules = getSchedulesForDay(staff, dayIndex);
                      return (
                        <td key={dayIndex} className="p-2 text-center">
                          <div className="space-y-1">
                            {daySchedules.map((schedule) => (
                              <Button
                                type="button"
                                variant="ghost"
                                key={schedule.id}
                                className={`h-auto w-full rounded-md p-2 transition-colors ${
                                  schedule.isAvailable
                                    ? SHIFT_COLORS[schedule.shiftType]
                                    : "bg-gray-100 text-gray-500 dark:bg-gray-800"
                                }`}
                                onClick={() => canManage && openEditDialog(staff.id, dayIndex, schedule)}
                                disabled={!canManage}
                              >
                                <div>
                                  <p className="text-xs font-medium">
                                    {formatTime(schedule.startTime)} - {formatTime(schedule.endTime)}
                                  </p>
                                  {!schedule.isAvailable && (
                                    <p className="text-xs italic">Off</p>
                                  )}
                                </div>
                              </Button>
                            ))}
                            {canManage && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => openEditDialog(staff.id, dayIndex)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    {canManage && (
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => openWeekDialog(staff)}
                            title="Set week schedule"
                          >
                            <CalendarDays className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setCopyDialog({ fromStaffId: staff.id, fromName: `${staff.firstName} ${staff.lastName}` })}
                            title="Copy schedule"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-2">Shift Types</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SHIFT_COLORS).map(([type, color]) => (
              <Badge key={type} className={color}>
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </Badge>
            ))}
            <Badge className="bg-gray-100 text-gray-500 dark:bg-gray-800">
              Day Off
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Edit/Create Schedule Dialog */}
      <Dialog open={!!editingSchedule} onOpenChange={() => setEditingSchedule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSchedule?.schedule ? "Edit Schedule" : "Add Schedule"}
            </DialogTitle>
            <DialogDescription>
              {editingSchedule && DAY_NAMES[editingSchedule.dayOfWeek]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Shift Type</Label>
              <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENING">Opening</SelectItem>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                  <SelectItem value="CLOSING">Closing</SelectItem>
                  <SelectItem value="SPLIT">Split</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            {editingSchedule?.schedule && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleToggleAvailability(editingSchedule.schedule!.id)}
                >
                  {editingSchedule.schedule.isAvailable ? (
                    <>
                      <X className="h-4 w-4 mr-1" /> Mark Off
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" /> Mark Available
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDeleteId(editingSchedule.schedule!.id);
                    setEditingSchedule(null);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </>
            )}
            <Button onClick={handleSaveSchedule} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Schedule Dialog */}
      <Dialog open={!!copyDialog} onOpenChange={() => { setCopyDialog(null); setCopyToStaffId(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy Schedule</DialogTitle>
            <DialogDescription>
              Copy {copyDialog?.fromName}&apos;s schedule to another staff member
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Copy To</Label>
            <Select value={copyToStaffId} onValueChange={setCopyToStaffId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {staffWithSchedules
                  .filter((s) => s.id !== copyDialog?.fromStaffId)
                  .map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.firstName} {staff.lastName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCopyDialog(null); setCopyToStaffId(""); }}>
              Cancel
            </Button>
            <Button onClick={handleCopySchedule} disabled={!copyToStaffId || isSubmitting}>
              {isSubmitting ? "Copying..." : "Copy Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Week Schedule Dialog */}
      <Dialog open={!!weekDialog} onOpenChange={() => setWeekDialog(null)}>
        <DialogContent className="sm:max-w-fit max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set Week Schedule</DialogTitle>
            <DialogDescription>
              Set {weekDialog?.staffName}&apos;s entire week at once. This will replace their current schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={!weekDays[1]?.enabled ? 0 : -1}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={applyToWeekdays}
                        disabled={!weekDays[1]?.enabled}
                      >
                        Apply Monday to all weekdays
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {!weekDays[1]?.enabled
                      ? "Enable Monday first to apply it to other weekdays"
                      : "Copy Monday's shifts to Tuesday through Friday"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {DAY_NAMES.map((day, index) => {
              const dayEntry = weekDays[index];
              const overlapError = dayOverlapErrors[index];
              return (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    dayEntry.enabled ? "bg-background" : "bg-muted/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-3 w-24 shrink-0 pt-1">
                      <Switch
                        checked={dayEntry.enabled}
                        onCheckedChange={(checked) => setDayEnabled(index, checked)}
                        aria-label={`Enable ${day}`}
                      />
                      <span className="text-sm font-medium">{day.slice(0, 3)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {dayEntry.enabled ? (
                        <div className="space-y-2">
                          {dayEntry.shifts.map((shift, shiftIndex) => (
                            <div key={shiftIndex} className="flex items-center gap-2">
                              <Input
                                type="time"
                                value={shift.startTime}
                                onChange={(e) =>
                                  updateShift(index, shiftIndex, { startTime: e.target.value })
                                }
                                className="w-[120px] h-8 text-sm"
                              />
                              <span className="text-muted-foreground text-xs">to</span>
                              <Input
                                type="time"
                                value={shift.endTime}
                                onChange={(e) =>
                                  updateShift(index, shiftIndex, { endTime: e.target.value })
                                }
                                className="w-[120px] h-8 text-sm"
                              />
                              <Select
                                value={shift.shiftType}
                                onValueChange={(v) =>
                                  updateShift(index, shiftIndex, { shiftType: v as ShiftType })
                                }
                              >
                                <SelectTrigger className="w-[110px] h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="OPENING">Opening</SelectItem>
                                  <SelectItem value="REGULAR">Regular</SelectItem>
                                  <SelectItem value="CLOSING">Closing</SelectItem>
                                  <SelectItem value="SPLIT">Split</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                                onClick={() => removeShift(index, shiftIndex)}
                                aria-label="Remove shift"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs border-dashed text-primary hover:text-primary"
                            onClick={() => addShift(index)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add shift
                          </Button>
                          {overlapError && (
                            <p className="text-xs text-destructive mt-1">{overlapError}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">Day off</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWeekDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveWeekSchedule} disabled={isSubmitting || hasAnyOverlap}>
              {isSubmitting ? "Saving..." : "Save Week Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
