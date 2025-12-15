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
} from "lucide-react";
import { toast } from "sonner";
import { ShiftType, Role } from "@prisma/client";

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
  deleteSchedule,
  createSchedule,
  updateSchedule,
  toggleScheduleAvailability,
  copySchedule,
} from "@/lib/actions/schedule";

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
  role: Role;
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

  const getScheduleForDay = (staff: StaffWithSchedules, dayOfWeek: number) => {
    return staff.schedules.find((s) => s.dayOfWeek === dayOfWeek);
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
                            {staff.role.toLowerCase().replace("_", " ")}
                          </p>
                        </div>
                      </div>
                    </td>
                    {DAY_NAMES.map((_, dayIndex) => {
                      const schedule = getScheduleForDay(staff, dayIndex);
                      return (
                        <td key={dayIndex} className="p-2 text-center">
                          {schedule ? (
                            <div
                              className={`p-2 rounded-md cursor-pointer transition-colors ${
                                schedule.isAvailable
                                  ? SHIFT_COLORS[schedule.shiftType]
                                  : "bg-gray-100 text-gray-500 dark:bg-gray-800"
                              }`}
                              onClick={() => canManage && openEditDialog(staff.id, dayIndex, schedule)}
                            >
                              <p className="text-xs font-medium">
                                {schedule.startTime} - {schedule.endTime}
                              </p>
                              {!schedule.isAvailable && (
                                <p className="text-xs italic">Off</p>
                              )}
                            </div>
                          ) : (
                            canManage && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => openEditDialog(staff.id, dayIndex)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            )
                          )}
                        </td>
                      );
                    })}
                    {canManage && (
                      <td className="p-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setCopyDialog({ fromStaffId: staff.id, fromName: `${staff.firstName} ${staff.lastName}` })}
                          title="Copy schedule"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
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
