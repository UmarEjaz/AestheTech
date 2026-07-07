"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import { AppointmentStatus, PaymentMethod } from "@prisma/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Scissors,
  Calendar,
  DollarSign,
  Check,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  PlayCircle,
  AlertCircle,
  Repeat,
  Download,
  Wallet,
  MoreHorizontal,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SELECTABLE_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/constants/payment-methods";
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
  addAppointmentDeposit,
} from "@/lib/actions/appointment";
import {
  cancelRecurringSeries,
  detachOccurrence,
  cancelFromDate,
} from "@/lib/actions/recurring-series";
import { RecurringSeriesBadge } from "./recurring-series-badge";
import { EditChoiceModal, EditChoice } from "./edit-choice-modal";
import { CancelChoiceModal, CancelScope } from "./cancel-choice-modal";

interface AppointmentDetailModalProps {
  appointment: AppointmentListItem;
  isOpen: boolean;
  onClose: () => void;
  onDataChange?: () => void;
  canUpdate?: boolean;
  canCancel?: boolean;
  canDelete?: boolean;
  timezone: string;
  // Info-only view (e.g. from a staff profile): hides all actions — edit/export/delete,
  // the checkout/lifecycle footer, and the "Take deposit" button. Just the details.
  readOnly?: boolean;
}

const statusConfig: Record<AppointmentStatus, { label: string; className: string }> = {
  SCHEDULED: {
    label: "Scheduled",
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800",
  },
  CONFIRMED: {
    label: "Confirmed",
    className:
      "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-200 dark:border-violet-800",
  },
  IN_PROGRESS: {
    label: "In Progress",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
  },
  COMPLETED: {
    label: "Completed",
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800",
  },
  CANCELLED: {
    label: "Cancelled",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800",
  },
  NO_SHOW: {
    label: "No Show",
    className:
      "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-800",
  },
};

// Happy-path lifecycle for the stepper. CANCELLED / NO_SHOW are off-path (handled separately).
const LIFECYCLE_STEPS: { key: AppointmentStatus; label: string }[] = [
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "COMPLETED", label: "Completed" },
];

export function AppointmentDetailModal({
  appointment,
  isOpen,
  onClose,
  onDataChange,
  canUpdate: canUpdateProp = false,
  canCancel: canCancelProp = false,
  canDelete: canDeleteProp = false,
  timezone,
  readOnly = false,
}: AppointmentDetailModalProps) {
  // In read-only mode, every capability is off so no action UI renders.
  const canUpdate = readOnly ? false : canUpdateProp;
  const canCancel = readOnly ? false : canCancelProp;
  const canDelete = readOnly ? false : canDeleteProp;
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelSeriesDialog, setShowCancelSeriesDialog] = useState(false);
  const [showEditChoiceModal, setShowEditChoiceModal] = useState(false);
  const [showCancelChoiceModal, setShowCancelChoiceModal] = useState(false);
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>(PaymentMethod.CASH);

  // Check if this is a series appointment
  const isSeriesAppointment = !!appointment.series && appointment.series.isActive;

  // Deposits taken against this appointment (applied at checkout).
  const depositPaid = appointment.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const isCheckedOut = !!appointment.sale;
  // Total across all services on the appointment.
  const servicePrice = appointment.services.reduce((sum, s) => sum + Number(s.price), 0);
  const totalDuration = appointment.services.reduce((sum, s) => sum + s.duration, 0);
  const balanceDue = Math.max(0, Math.round((servicePrice - depositPaid) * 100) / 100);
  // When the deposit exceeds the total (e.g. a service was removed), the excess is refunded at checkout.
  const refundDue = Math.max(0, Math.round((depositPaid - servicePrice) * 100) / 100);
  const canTakeDeposit =
    canUpdate &&
    !isCheckedOut &&
    balanceDue > 0 && // nothing more to collect once the deposit covers the total
    !["CANCELLED", "NO_SHOW"].includes(appointment.status);
  const initials = `${appointment.client.firstName?.[0] ?? ""}${appointment.client.lastName?.[0] ?? ""}`.toUpperCase();

  const handleAddDeposit = async () => {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid deposit amount");
      return;
    }
    setIsUpdating(true);
    try {
      const result = await addAppointmentDeposit(appointment.id, { amount, method: depositMethod });
      if (result.success) {
        toast.success(
          `$${amount.toFixed(2)} deposit recorded for ${appointment.client.firstName} ${appointment.client.lastName || ""}`.trim()
        );
        setShowDepositDialog(false);
        setDepositAmount("");
        setDepositMethod(PaymentMethod.CASH);
        onDataChange?.();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReactivate = async () => {
    setIsUpdating(true);
    try {
      const result = await updateAppointmentStatus(appointment.id, { status: "SCHEDULED" });
      if (result.success) {
        toast.success("Appointment reactivated — it's back to Scheduled");
        onDataChange?.();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
    }
  };

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

  const handleCancelSeries = async () => {
    if (!appointment.series?.id) return;

    setIsUpdating(true);
    try {
      const result = await cancelRecurringSeries(appointment.series.id);
      if (result.success) {
        toast.success(`Cancelled ${result.data.cancelledCount} future appointments in the series`);
        onDataChange?.();
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsUpdating(false);
      setShowCancelSeriesDialog(false);
    }
  };

  // Handle edit choice for series appointments
  const handleEditChoice = async (choice: EditChoice) => {
    setShowEditChoiceModal(false);

    if (choice === "this_only") {
      // Detach this occurrence from the series, then navigate to edit
      if (appointment.series?.id) {
        setIsUpdating(true);
        try {
          const result = await detachOccurrence(appointment.id);
          if (result.success) {
            toast.success("Appointment detached from series");
            // Navigate to edit page
            router.push(`/dashboard/appointments/${appointment.id}/edit`);
            onClose();
          } else {
            toast.error(result.error);
          }
        } finally {
          setIsUpdating(false);
        }
      }
    } else {
      // For "all_future" or "all_in_series", navigate to a series edit page
      // For now, show a message that this will be implemented
      toast.info("Editing all occurrences - navigating to series settings");
      // Navigate to client page where they can manage the series
      router.push(`/dashboard/clients/${appointment.clientId}`);
      onClose();
    }
  };

  // Handle cancel/delete choice for series appointments
  const handleCancelChoice = async (scope: CancelScope) => {
    setShowCancelChoiceModal(false);
    setIsUpdating(true);

    try {
      if (scope === "this_only") {
        // Cancel just this appointment
        const result = await cancelAppointment(appointment.id);
        if (result.success) {
          toast.success("Appointment cancelled");
          onDataChange?.();
          router.refresh();
          onClose();
        } else {
          toast.error(result.error);
        }
      } else if (scope === "this_and_future" && appointment.series?.id) {
        // Cancel this and all future appointments
        const result = await cancelFromDate({
          seriesId: appointment.series.id,
          fromDate: new Date(appointment.startTime),
        });
        if (result.success) {
          toast.success(`Cancelled ${result.data.cancelledCount} appointments`);
          onDataChange?.();
          router.refresh();
          onClose();
        } else {
          toast.error(result.error);
        }
      } else if (scope === "entire_series" && appointment.series?.id) {
        // Cancel entire series
        const result = await cancelRecurringSeries(appointment.series.id);
        if (result.success) {
          toast.success(`Cancelled ${result.data.cancelledCount} appointments in the series`);
          onDataChange?.();
          router.refresh();
          onClose();
        } else {
          toast.error(result.error);
        }
      }
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle clicking Edit button
  const handleEditClick = () => {
    if (isSeriesAppointment) {
      setShowEditChoiceModal(true);
    } else {
      router.push(`/dashboard/appointments/${appointment.id}/edit`);
    }
  };

  // Handle clicking Cancel button
  const handleCancelClick = () => {
    if (isSeriesAppointment) {
      setShowCancelChoiceModal(true);
    } else {
      setShowCancelDialog(true);
    }
  };

  const canConfirm = appointment.status === "SCHEDULED";
  const canStart = appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";
  // No standalone "Complete": an appointment is completed by checking it out (which
  // creates the sale, applies the deposit, and settles the balance). Marking complete
  // without checkout would strand the deposit and skip the sale.
  const statusAllowsCancel = !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);
  const canMarkNoShow =
    appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";
  // Reactivate a no-show (client came late) or a cancelled booking → back to Scheduled.
  const canUndoNoShow = canUpdate && appointment.status === "NO_SHOW";
  const canReopen = canUpdate && appointment.status === "CANCELLED";
  const showLifecycleFooter =
    (canUpdate && (canConfirm || canStart || canMarkNoShow)) ||
    (canCancel && statusAllowsCancel) ||
    canUndoNoShow ||
    canReopen;

  // Status stepper: happy path (Scheduled→Completed) or an off-path strip (cancelled/no-show).
  const isOffPath = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW";
  const currentStep = LIFECYCLE_STEPS.findIndex((s) => s.key === appointment.status);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg [&>button]:hidden"
        >
          <SheetDescription className="sr-only">
            Details for the appointment with {appointment.client.firstName} {appointment.client.lastName}.
          </SheetDescription>

          {/* Tinted header (lavender): status + actions + client hero */}
          <div className="border-b bg-gradient-to-br from-violet-50 to-purple-50/60 dark:from-violet-950/40 dark:to-purple-950/25">
          {/* Top bar: status + actions */}
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <Badge variant="outline" className={statusConfig[appointment.status].className}>
              {statusConfig[appointment.status].label}
            </Badge>
            <div className="flex items-center gap-0.5">
              {canUpdate && appointment.status !== "COMPLETED" && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleEditClick} disabled={isUpdating} title="Edit" aria-label="Edit appointment">
                  <Edit className="h-4 w-4" />
                </Button>
              )}
              {!readOnly && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(`/api/ical/appointment/${appointment.id}`, "_blank")} disabled={isUpdating} title="Export" aria-label="Export appointment">
                  <Download className="h-4 w-4" />
                </Button>
              )}
              {canDelete && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isUpdating} title="More actions" aria-label="More actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setShowDeleteDialog(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Close" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Client hero — the first thing you see */}
          <div className="flex items-center gap-3.5 px-5 pb-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 text-xl font-bold text-white shadow-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate text-2xl font-bold leading-tight">
                {appointment.client.firstName} {appointment.client.lastName}
              </SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                <span className="truncate">{appointment.client.phone || "No phone"}</span>
                {appointment.client.email && <span className="truncate">· {appointment.client.email}</span>}
                {appointment.client.isWalkIn && (
                  <Badge variant="secondary" className="text-[10px]">Walk-in</Badge>
                )}
              </div>
            </div>
          </div>
          </div>

          {/* Body (scrolls) — soft pastel cards */}
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">

            {/* Services (1..N), each with its own staff */}
            <div className="rounded-2xl bg-blue-50 p-3.5 dark:bg-blue-950/40">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  <Scissors className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-blue-700/80 dark:text-blue-400">
                    {appointment.services.length > 1 ? "Services" : "Service"}
                  </div>
                </div>
                {/* Aggregate total only when there are 2+ services — otherwise it just
                    repeats the single line's price/duration. */}
                {appointment.services.length > 1 && (
                  <div className="shrink-0 text-right text-sm">
                    <div className="font-bold">${servicePrice.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{totalDuration} min</div>
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-1.5 pl-[52px]">
                {appointment.services.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{line.service.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {line.staff.firstName} {line.staff.lastName} · {line.duration} min
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold">${Number(line.price).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Schedule */}
            <div className="flex items-center gap-3 rounded-2xl bg-pink-50 p-3.5 dark:bg-pink-950/40">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-pink-700/80 dark:text-pink-400">Schedule</div>
                <div className="mt-0.5 truncate font-bold">
                  {formatInTz(appointment.startTime, "EEE, MMM d, yyyy", timezone)}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatInTz(appointment.startTime, "h:mm a", timezone)} – {formatInTz(appointment.endTime, "h:mm a", timezone)}
                </div>
              </div>
            </div>

            {/* Status stepper — after the facts, dividing them from the money section */}
            {isOffPath ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold",
                  appointment.status === "CANCELLED"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                )}
              >
                {appointment.status === "CANCELLED" ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {appointment.status === "CANCELLED" ? "This appointment was cancelled" : "Marked as a no-show"}
              </div>
            ) : (
              <div className="flex items-start px-1 py-2">
                {LIFECYCLE_STEPS.map((step, i) => {
                  const done = i < currentStep;
                  const current = i === currentStep;
                  return (
                    <div key={step.key} className="relative flex flex-1 flex-col items-center text-center">
                      {i < LIFECYCLE_STEPS.length - 1 && (
                        <span
                          className={cn(
                            "absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-3 h-0.5",
                            done ? "bg-primary" : "bg-muted-foreground/25"
                          )}
                        />
                      )}
                      <div
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                          done
                            ? "bg-primary text-primary-foreground"
                            : current
                              ? "border-2 border-primary bg-background text-primary"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      <div
                        className={cn(
                          "mt-1.5 text-[11px] font-semibold leading-tight",
                          current ? "text-foreground" : done ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        {step.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recurring Series Info */}
            {appointment.series && (
              <div className="space-y-1.5 rounded-2xl bg-muted/60 p-3.5">
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Repeat className="h-4 w-4" />
                  Recurring Appointment
                </h3>
                <div className="flex items-center gap-2">
                  <RecurringSeriesBadge
                    pattern={appointment.series.pattern}
                    customWeeks={appointment.series.customWeeks}
                    isActive={appointment.series.isActive}
                    showLabel
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This appointment is part of a recurring series.
                  {!appointment.series.isActive && " The series has been cancelled."}
                </p>
              </div>
            )}

            {/* Notes */}
            {appointment.notes && (
              <div className="space-y-1.5 rounded-2xl bg-muted/60 p-3.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notes</h3>
                <p className="text-sm">{appointment.notes}</p>
              </div>
            )}

            {/* Deposit — pushed to the bottom so the money sits right above the Balance-due / Check out footer */}
            {(depositPaid > 0 || canTakeDeposit) && (
              <div className="mt-auto flex items-center gap-3 rounded-2xl bg-emerald-50 p-3.5 dark:bg-emerald-950/40">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400">Deposit</div>
                  {depositPaid > 0 ? (
                    <div className="mt-0.5 font-bold">
                      ${depositPaid.toFixed(2)} paid
                      {isCheckedOut ? (
                        <span className="font-medium text-muted-foreground"> · applied at checkout</span>
                      ) : refundDue > 0 ? (
                        <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                          ${refundDue.toFixed(2)} to refund
                        </span>
                      ) : balanceDue > 0 ? (
                        <span className="font-medium text-muted-foreground"> · balance ${balanceDue.toFixed(2)}</span>
                      ) : (
                        <span className="font-medium text-muted-foreground"> · fully covered</span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-sm text-muted-foreground">No deposit taken yet.</div>
                  )}
                </div>
                {canTakeDeposit && (
                  <Button size="sm" variant="outline" className="shrink-0 bg-background" onClick={() => setShowDepositDialog(true)} disabled={isUpdating}>
                    Take deposit
                  </Button>
                )}
              </div>
            )}

          </div>

          {/* Sticky footer — hidden in read-only mode (no checkout / lifecycle) */}
          {!readOnly && (
          <div className="space-y-3 border-t bg-background px-5 py-4">
            {depositPaid > 0 && !isCheckedOut && refundDue > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Refund at checkout</span>
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-base font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                  ${refundDue.toFixed(2)}
                </span>
              </div>
            )}
            {depositPaid > 0 && !isCheckedOut && refundDue === 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Balance due now</span>
                <span className="text-xl font-bold">${balanceDue.toFixed(2)}</span>
              </div>
            )}

            {isCheckedOut ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (appointment.sale) {
                    router.push(`/dashboard/sales/${appointment.sale.id}`);
                    onClose();
                  }
                }}
              >
                <DollarSign className="mr-1 h-4 w-4" />
                View sale
              </Button>
            ) : (
              !["CANCELLED", "NO_SHOW"].includes(appointment.status) && (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    router.push(`/dashboard/sales/new?appointmentId=${appointment.id}`);
                    onClose();
                  }}
                >
                  <DollarSign className="mr-1 h-4 w-4" />
                  Check out
                </Button>
              )
            )}

            {showLifecycleFooter && (
              <div className="flex gap-2">
                {(canUndoNoShow || canReopen) && (
                  <Button size="sm" variant="outline" className="min-w-0 flex-1" onClick={handleReactivate} disabled={isUpdating}>
                    <Repeat className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">{canUndoNoShow ? "Undo no-show" : "Reopen appointment"}</span>
                  </Button>
                )}
                {canUpdate && canConfirm && (
                  <Button size="sm" variant="outline" className="min-w-0 flex-1 px-2" onClick={() => handleStatusUpdate("CONFIRMED")} disabled={isUpdating}>
                    <CheckCircle className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">Confirm</span>
                  </Button>
                )}
                {canUpdate && canStart && (
                  <Button size="sm" variant="outline" className="min-w-0 flex-1 px-2" onClick={() => handleStatusUpdate("IN_PROGRESS")} disabled={isUpdating}>
                    <PlayCircle className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">Start</span>
                  </Button>
                )}
                {canUpdate && canMarkNoShow && (
                  <Button size="sm" variant="outline" className="min-w-0 flex-1 px-2" onClick={() => handleStatusUpdate("NO_SHOW")} disabled={isUpdating}>
                    <AlertCircle className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">No Show</span>
                  </Button>
                )}
                {canCancel && statusAllowsCancel && (
                  <Button size="sm" variant="outline" className="min-w-0 flex-1 px-2 text-destructive hover:text-destructive" onClick={handleCancelClick} disabled={isUpdating}>
                    <XCircle className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">Cancel</span>
                  </Button>
                )}
              </div>
            )}
          </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Cancel Confirmation */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this appointment for{" "}
              {appointment.client.firstName} {appointment.client.lastName}?
              {depositPaid > 0 && (
                <span className="mt-2 block font-medium text-destructive">
                  Heads up: a ${depositPaid.toFixed(2)} deposit was taken — remember to refund it to the client.
                </span>
              )}
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

      {/* Cancel Series Confirmation */}
      <AlertDialog open={showCancelSeriesDialog} onOpenChange={setShowCancelSeriesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Recurring Series?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel all future appointments in this recurring series for{" "}
              {appointment.client.firstName} {appointment.client.lastName}. Past and completed
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

      {/* Take Deposit dialog */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Take deposit</DialogTitle>
            <DialogDescription>
              Record a prepayment for {appointment.client.firstName}&apos;s appointment. It&apos;s
              held against the appointment and applied at checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="deposit-amount">Amount</Label>
              <Input
                id="deposit-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-method">Method</Label>
              <Select value={depositMethod} onValueChange={(v) => setDepositMethod(v as PaymentMethod)}>
                <SelectTrigger id="deposit-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepositDialog(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button onClick={handleAddDeposit} disabled={isUpdating}>
              {isUpdating ? "Saving…" : "Record deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Choice Modal for Series Appointments */}
      <EditChoiceModal
        isOpen={showEditChoiceModal}
        onClose={() => setShowEditChoiceModal(false)}
        onChoice={handleEditChoice}
        appointmentDate={new Date(appointment.startTime)}
        timezone={timezone}
        isLoading={isUpdating}
      />

      {/* Cancel Choice Modal for Series Appointments */}
      <CancelChoiceModal
        isOpen={showCancelChoiceModal}
        onClose={() => setShowCancelChoiceModal(false)}
        onChoice={handleCancelChoice}
        appointmentDate={new Date(appointment.startTime)}
        timezone={timezone}
        isLoading={isUpdating}
        mode="cancel"
        clientName={`${appointment.client.firstName} ${appointment.client.lastName || ""}`.trim()}
      />
    </>
  );
}
