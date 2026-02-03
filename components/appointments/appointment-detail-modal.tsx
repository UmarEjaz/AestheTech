"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AppointmentStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  Clock,
  User,
  Scissors,
  Phone,
  Mail,
  Calendar,
  DollarSign,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  PlayCircle,
  AlertCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  AppointmentListItem,
  updateAppointmentStatus,
  cancelAppointment,
  deleteAppointment,
} from "@/lib/actions/appointment";

interface AppointmentDetailModalProps {
  appointment: AppointmentListItem;
  isOpen: boolean;
  onClose: () => void;
  onDataChange?: () => void;
  canManage?: boolean;
}

const statusConfig: Record<
  AppointmentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  SCHEDULED: { label: "Scheduled", variant: "secondary" },
  CONFIRMED: { label: "Confirmed", variant: "default" },
  IN_PROGRESS: { label: "In Progress", variant: "default" },
  COMPLETED: { label: "Completed", variant: "outline" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  NO_SHOW: { label: "No Show", variant: "destructive" },
};

export function AppointmentDetailModal({
  appointment,
  isOpen,
  onClose,
  onDataChange,
  canManage = false,
}: AppointmentDetailModalProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleStatusUpdate = async (newStatus: AppointmentStatus) => {
    setIsUpdating(true);
    try {
      const result = await updateAppointmentStatus(appointment.id, { status: newStatus });
      if (result.success) {
        toast.success(`Appointment marked as ${statusConfig[newStatus].label}`);
        onDataChange?.();
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancel = async () => {
    setIsUpdating(true);
    try {
      const result = await cancelAppointment(appointment.id);
      if (result.success) {
        toast.success("Appointment cancelled");
        onDataChange?.();
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowCancelDialog(false);
    }
  };

  const handleDelete = async () => {
    setIsUpdating(true);
    try {
      const result = await deleteAppointment(appointment.id);
      if (result.success) {
        toast.success("Appointment deleted");
        onDataChange?.();
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowDeleteDialog(false);
    }
  };

  const canConfirm = appointment.status === "SCHEDULED";
  const canStart = appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";
  const canComplete = appointment.status === "IN_PROGRESS";
  const canCancel = !["COMPLETED", "CANCELLED"].includes(appointment.status);
  const canMarkNoShow =
    appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl">Appointment Details</DialogTitle>
              <Badge variant={statusConfig[appointment.status].variant}>
                {statusConfig[appointment.status].label}
              </Badge>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Client Info */}
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <User className="h-4 w-4" />
                Client
              </h3>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {appointment.client.firstName} {appointment.client.lastName}
                </p>
                {appointment.client.isWalkIn && (
                  <Badge variant="secondary" className="text-xs">
                    Walk-in
                  </Badge>
                )}
              </div>
              {appointment.client.phone ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Phone className="h-3 w-3" />
                  {appointment.client.phone}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/60 flex items-center gap-2">
                  <Phone className="h-3 w-3" />
                  <span className="italic">No phone</span>
                </p>
              )}
              {appointment.client.email && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Mail className="h-3 w-3" />
                  {appointment.client.email}
                </p>
              )}
            </div>

            {/* Service Info */}
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Scissors className="h-4 w-4" />
                Service
              </h3>
              <p className="font-medium">{appointment.service.name}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {appointment.service.duration} min
                </span>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {Number(appointment.service.price).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Time & Staff */}
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Schedule
              </h3>
              <p className="font-medium">
                {format(new Date(appointment.startTime), "EEEE, MMMM d, yyyy")}
              </p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(appointment.startTime), "h:mm a")} -{" "}
                {format(new Date(appointment.endTime), "h:mm a")}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Staff:</span>{" "}
                {appointment.staff.firstName} {appointment.staff.lastName}
              </p>
            </div>

            {/* Notes */}
            {appointment.notes && (
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="font-semibold">Notes</h3>
                <p className="text-sm text-muted-foreground">{appointment.notes}</p>
              </div>
            )}

            {/* Actions */}
            {canManage && (
              <div className="space-y-2 pt-2">
                {/* Status Actions */}
                <div className="flex flex-wrap gap-2">
                  {canConfirm && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusUpdate("CONFIRMED")}
                      disabled={isUpdating}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Confirm
                    </Button>
                  )}
                  {canStart && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusUpdate("IN_PROGRESS")}
                      disabled={isUpdating}
                    >
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Start
                    </Button>
                  )}
                  {canComplete && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusUpdate("COMPLETED")}
                      disabled={isUpdating}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Complete
                    </Button>
                  )}
                  {canMarkNoShow && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusUpdate("NO_SHOW")}
                      disabled={isUpdating}
                    >
                      <AlertCircle className="h-4 w-4 mr-1" />
                      No Show
                    </Button>
                  )}
                </div>

                {/* Edit/Cancel/Delete Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      router.push(`/dashboard/appointments/${appointment.id}/edit`)
                    }
                    disabled={isUpdating || appointment.status === "COMPLETED"}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  {canCancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowCancelDialog(true)}
                      disabled={isUpdating}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={isUpdating}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this appointment for{" "}
              {appointment.client.firstName} {appointment.client.lastName}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={isUpdating}>
              Yes, cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the appointment. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isUpdating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
