"use client";

import { useState } from "react";
import { CalendarDays, Calendar, Repeat } from "lucide-react";

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

export type EditChoice = "this_only" | "all_future" | "all_in_series";

interface EditChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChoice: (choice: EditChoice) => void;
  appointmentDate?: Date;
  isLoading?: boolean;
  showAllInSeries?: boolean; // Show option to edit all appointments in series (past + future)
}

export function EditChoiceModal({
  isOpen,
  onClose,
  onChoice,
  appointmentDate,
  isLoading = false,
  showAllInSeries = false,
}: EditChoiceModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<EditChoice>("this_only");

  const handleConfirm = () => {
    onChoice(selectedChoice);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reset selection when closing
      setSelectedChoice("this_only");
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Edit Recurring Appointment
          </AlertDialogTitle>
          <AlertDialogDescription>
            This appointment is part of a recurring series. How would you like to edit it?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={selectedChoice}
          onValueChange={(value) => setSelectedChoice(value as EditChoice)}
          className="space-y-3 py-4"
        >
          <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <RadioGroupItem value="this_only" id="this_only" className="mt-0.5" />
            <Label htmlFor="this_only" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 font-medium">
                <Calendar className="h-4 w-4" />
                This occurrence only
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Edit only the appointment{appointmentDate ? ` on ${appointmentDate.toLocaleDateString()}` : ""}.
                Other appointments in the series will not be affected.
              </p>
            </Label>
          </div>

          <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <RadioGroupItem value="all_future" id="all_future" className="mt-0.5" />
            <Label htmlFor="all_future" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 font-medium">
                <CalendarDays className="h-4 w-4" />
                This and all future occurrences
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Edit this appointment and all future appointments in the series. Past appointments will not be affected.
              </p>
            </Label>
          </div>

          {showAllInSeries && (
            <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="all_in_series" id="all_in_series" className="mt-0.5" />
              <Label htmlFor="all_in_series" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2 font-medium">
                  <Repeat className="h-4 w-4" />
                  All appointments in series
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Edit all appointments in the series, including past appointments.
                </p>
              </Label>
            </div>
          )}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? "Processing..." : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
