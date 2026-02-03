"use client";

import { useState } from "react";
import { CalendarDays, Calendar, Repeat, XCircle, Trash2 } from "lucide-react";

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export type CancelScope = "this_only" | "this_and_future" | "entire_series";

interface CancelChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChoice: (scope: CancelScope) => void;
  appointmentDate?: Date;
  isLoading?: boolean;
  mode: "cancel" | "delete";
  clientName?: string;
}

export function CancelChoiceModal({
  isOpen,
  onClose,
  onChoice,
  appointmentDate,
  isLoading = false,
  mode,
  clientName,
}: CancelChoiceModalProps) {
  const [selectedScope, setSelectedScope] = useState<CancelScope>("this_only");

  const actionLabel = mode === "cancel" ? "Cancel" : "Delete";
  const actionLabelLower = mode === "cancel" ? "cancel" : "delete";
  const Icon = mode === "cancel" ? XCircle : Trash2;

  const handleConfirm = () => {
    onChoice(selectedScope);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reset selection when closing
      setSelectedScope("this_only");
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-destructive" />
            {actionLabel} Recurring Appointment
          </AlertDialogTitle>
          <AlertDialogDescription>
            This appointment{clientName ? ` for ${clientName}` : ""} is part of a recurring series.
            What would you like to {actionLabelLower}?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={selectedScope}
          onValueChange={(value) => setSelectedScope(value as CancelScope)}
          className="space-y-3 py-4"
        >
          <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <RadioGroupItem value="this_only" id="cancel_this_only" className="mt-0.5" />
            <Label htmlFor="cancel_this_only" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 font-medium">
                <Calendar className="h-4 w-4" />
                This occurrence only
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {actionLabel} only the appointment{appointmentDate ? ` on ${appointmentDate.toLocaleDateString()}` : ""}.
                Other appointments in the series will continue as scheduled.
              </p>
            </Label>
          </div>

          <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <RadioGroupItem value="this_and_future" id="cancel_this_and_future" className="mt-0.5" />
            <Label htmlFor="cancel_this_and_future" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 font-medium">
                <CalendarDays className="h-4 w-4" />
                This and all future occurrences
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {actionLabel} this appointment and all future appointments in the series.
                Past appointments will not be affected.
              </p>
            </Label>
          </div>

          <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors border-destructive/50">
            <RadioGroupItem value="entire_series" id="cancel_entire_series" className="mt-0.5" />
            <Label htmlFor="cancel_entire_series" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <Repeat className="h-4 w-4" />
                Entire series
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {actionLabel} the entire recurring series, including all past and future appointments.
                {mode === "delete" && " This action cannot be undone."}
              </p>
            </Label>
          </div>
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Keep appointments</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? "Processing..." : `${actionLabel} Selected`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
