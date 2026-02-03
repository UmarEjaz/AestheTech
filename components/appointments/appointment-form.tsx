"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, addWeeks, addMonths } from "date-fns";
import { Loader2, Calendar as CalendarIcon, UserPlus, Users, Repeat, Info, DollarSign, Clock, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  appointmentSchema,
  AppointmentFormData,
  AppointmentFormInput,
} from "@/lib/validations/appointment";
import { RecurrencePattern, RecurrenceEndType } from "@prisma/client";
import { PatternSelector, getPatternSummary } from "./pattern-selector";
import { EndConditionSelector, getEndConditionSummary } from "./end-condition-selector";
import {
  createAppointment,
  updateAppointment,
  getAvailableSlots,
  AppointmentListItem,
} from "@/lib/actions/appointment";
import { createRecurringSeries, previewRecurringConflicts, ConflictPreview } from "@/lib/actions/recurring-series";
import { ConflictResolutionUI, AlternativeSlot, SelectedAlternative } from "./conflict-resolution-ui";
import { createWalkInClient } from "@/lib/actions/client";
import { cn } from "@/lib/utils";

interface Client {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  isWalkIn?: boolean;
}

interface Service {
  id: string;
  name: string;
  duration: number;
  price: number | string;
  category: string | null;
}

interface Staff {
  id: string;
  firstName: string;
  lastName: string;
}

interface AppointmentFormProps {
  mode: "create" | "edit";
  appointment?: AppointmentListItem;
  clients: Client[];
  services: Service[];
  staff: Staff[];
  initialDate?: Date;
}

export function AppointmentForm({
  mode,
  appointment,
  clients,
  services,
  staff,
  initialDate,
}: AppointmentFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    appointment ? new Date(appointment.startTime) : initialDate || new Date()
  );
  const [availableSlots, setAvailableSlots] = useState<{ startTime: Date; endTime: Date }[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Walk-in client state
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  // Recurring appointment state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("WEEKLY");
  const [customWeeks, setCustomWeeks] = useState<number>(3);
  const [specificDays, setSpecificDays] = useState<number[]>([]);
  const [nthWeek, setNthWeek] = useState<number>(1);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [endType, setEndType] = useState<RecurrenceEndType>("NEVER");
  const [endAfterCount, setEndAfterCount] = useState<number>(12);
  const [endByDate, setEndByDate] = useState<Date | undefined>();
  const [lockedPrice, setLockedPrice] = useState<number | undefined>();
  const [bufferMinutes, setBufferMinutes] = useState<number>(0);

  // Conflict preview state
  const [isPreviewingConflicts, setIsPreviewingConflicts] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<{
    totalDates: number;
    availableDates: Date[];
    conflicts: ConflictPreview[];
  } | null>(null);
  const [selectedAlternatives, setSelectedAlternatives] = useState<SelectedAlternative[]>([]);
  const [skippedDates, setSkippedDates] = useState<Date[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AppointmentFormInput, unknown, AppointmentFormData>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      clientId: appointment?.clientId || "",
      serviceId: appointment?.serviceId || "",
      staffId: appointment?.staffId || "",
      startTime: appointment ? new Date(appointment.startTime) : initialDate || new Date(),
      notes: appointment?.notes || "",
    },
  });

  const watchedStaffId = watch("staffId");
  const watchedServiceId = watch("serviceId");
  const watchedStartTime = watch("startTime");

  // Update dayOfWeek when selected date changes
  useEffect(() => {
    if (selectedDate) {
      setDayOfWeek(selectedDate.getDay());
      // For SPECIFIC_DAYS, ensure the selected day is included
      if (recurrencePattern === "SPECIFIC_DAYS" && !specificDays.includes(selectedDate.getDay())) {
        setSpecificDays([selectedDate.getDay()]);
      }
    }
  }, [selectedDate, recurrencePattern, specificDays]);

  // Calculate preview dates for recurring appointments
  const previewDates = useMemo(() => {
    if (!isRecurring || !watchedStartTime) return [];

    const startDate = watchedStartTime instanceof Date ? watchedStartTime : new Date(watchedStartTime as string | number);
    const dates: Date[] = [];
    let currentDate = new Date(startDate);
    const endDate = addMonths(new Date(), 3);
    const maxCount = endType === "AFTER_COUNT" ? Math.min(endAfterCount, 6) : 6;

    // Generate dates for next 3 months (show first 6 for preview)
    let count = 0;
    while (currentDate <= endDate && count < maxCount) {
      // Check if we've passed the end date
      if (endType === "BY_DATE" && endByDate && currentDate > endByDate) break;

      if (currentDate >= new Date()) {
        // For SPECIFIC_DAYS, only add if it's one of the selected days
        if (recurrencePattern === "SPECIFIC_DAYS") {
          if (specificDays.includes(currentDate.getDay())) {
            dates.push(new Date(currentDate));
            count++;
          }
          // Always advance by 1 day for SPECIFIC_DAYS
          currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
        } else {
          dates.push(new Date(currentDate));
          count++;

          switch (recurrencePattern) {
            case "DAILY":
              currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
              break;
            case "WEEKLY":
              currentDate = addWeeks(currentDate, 1);
              break;
            case "BIWEEKLY":
              currentDate = addWeeks(currentDate, 2);
              break;
            case "MONTHLY":
            case "NTH_WEEKDAY":
              currentDate = addMonths(currentDate, 1);
              break;
            case "CUSTOM":
              currentDate = addWeeks(currentDate, customWeeks);
              break;
          }
        }
      } else {
        // Move to next occurrence if before today
        if (recurrencePattern === "SPECIFIC_DAYS" || recurrencePattern === "DAILY") {
          currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
        } else if (recurrencePattern === "WEEKLY") {
          currentDate = addWeeks(currentDate, 1);
        } else if (recurrencePattern === "BIWEEKLY") {
          currentDate = addWeeks(currentDate, 2);
        } else if (recurrencePattern === "MONTHLY" || recurrencePattern === "NTH_WEEKDAY") {
          currentDate = addMonths(currentDate, 1);
        } else if (recurrencePattern === "CUSTOM") {
          currentDate = addWeeks(currentDate, customWeeks);
        }
      }
    }

    return dates;
  }, [isRecurring, watchedStartTime, recurrencePattern, customWeeks, specificDays, endType, endAfterCount, endByDate]);

  // Fetch available slots when staff, service, or date changes
  useEffect(() => {
    const fetchSlots = async () => {
      if (!watchedStaffId || !watchedServiceId || !selectedDate) return;

      setIsLoadingSlots(true);
      try {
        const result = await getAvailableSlots({
          staffId: watchedStaffId,
          date: selectedDate,
          serviceId: watchedServiceId,
          // In edit mode, exclude the current appointment from conflict check
          excludeAppointmentId: mode === "edit" ? appointment?.id : undefined,
        });

        if (result.success) {
          setAvailableSlots(result.data);
        }
      } finally {
        setIsLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [watchedStaffId, watchedServiceId, selectedDate, mode, appointment?.id]);

  // Auto-select the matching time slot when slots load
  useEffect(() => {
    if (availableSlots.length === 0) return;

    // Determine the target time to match
    const targetTime = mode === "edit" && appointment
      ? new Date(appointment.startTime).getTime()
      : initialDate?.getTime();

    if (!targetTime) return;

    // Find the slot that matches the target time
    const matchingSlot = availableSlots.find((slot) => {
      const slotTime = new Date(slot.startTime).getTime();
      // Allow small difference (1 minute) for timezone/serialization issues
      return Math.abs(slotTime - targetTime) < 60 * 1000;
    });

    if (matchingSlot) {
      setValue("startTime", new Date(matchingSlot.startTime));
    } else if (mode === "create" && initialDate) {
      // For create mode, find the closest slot if no exact match
      let closestSlot = availableSlots[0];
      let closestDiff = Math.abs(new Date(closestSlot.startTime).getTime() - targetTime);

      for (const slot of availableSlots) {
        const diff = Math.abs(new Date(slot.startTime).getTime() - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestSlot = slot;
        }
      }

      setValue("startTime", new Date(closestSlot.startTime));
    } else if (mode === "edit" && appointment) {
      // In edit mode, warn the user that their original time slot is no longer available
      toast.warning("Original time slot is no longer available. Please select a new time.");
    }
  }, [availableSlots, initialDate, mode, appointment, setValue]);

  // Reset conflict preview when recurring settings change
  useEffect(() => {
    setConflictPreview(null);
    setSelectedAlternatives([]);
    setSkippedDates([]);
  }, [recurrencePattern, customWeeks, specificDays, nthWeek, endType, endAfterCount, endByDate, watchedStartTime, watchedStaffId, watchedServiceId]);

  // Handle conflict preview
  const handlePreviewConflicts = async () => {
    if (!watchedServiceId || !watchedStaffId || !watchedStartTime) {
      toast.error("Please select service, staff, and time first");
      return;
    }

    // Get client ID (handle walk-in case)
    let clientId = watch("clientId");
    if (isWalkIn) {
      // For walk-in, we'll use a placeholder since we create client at submission
      clientId = "walk-in-placeholder";
    }

    if (!clientId && !isWalkIn) {
      toast.error("Please select a client first");
      return;
    }

    setIsPreviewingConflicts(true);
    try {
      const startTime = watchedStartTime instanceof Date ? watchedStartTime : new Date(watchedStartTime as string | number);
      const result = await previewRecurringConflicts({
        clientId: clientId || "placeholder",
        serviceId: watchedServiceId,
        staffId: watchedStaffId,
        pattern: recurrencePattern,
        customWeeks: recurrencePattern === "CUSTOM" ? customWeeks : undefined,
        dayOfWeek: recurrencePattern === "SPECIFIC_DAYS" ? specificDays[0] ?? startTime.getDay() : startTime.getDay(),
        timeOfDay: format(startTime, "HH:mm"),
        specificDays: recurrencePattern === "SPECIFIC_DAYS" ? specificDays : undefined,
        nthWeek: recurrencePattern === "NTH_WEEKDAY" ? nthWeek : undefined,
        endType,
        endAfterCount: endType === "AFTER_COUNT" ? endAfterCount : undefined,
        endByDate: endType === "BY_DATE" ? endByDate : undefined,
        lockedPrice,
        bufferMinutes: bufferMinutes > 0 ? bufferMinutes : undefined,
      });

      if (result.success) {
        setConflictPreview(result.data);
        setSelectedAlternatives([]);
        setSkippedDates([]);

        if (result.data.conflicts.length === 0) {
          toast.success(`All ${result.data.totalDates} dates are available!`);
        } else {
          toast.info(`${result.data.conflicts.length} of ${result.data.totalDates} dates have conflicts`);
        }
      } else {
        toast.error(result.error);
      }
    } finally {
      setIsPreviewingConflicts(false);
    }
  };

  // Handle selecting an alternative slot
  const handleSelectAlternative = (originalDate: Date, alternative: AlternativeSlot) => {
    setSelectedAlternatives((prev) => {
      // Remove any existing selection for this date
      const filtered = prev.filter(
        (sa) => sa.originalDate.toDateString() !== originalDate.toDateString()
      );
      // Add the new selection
      return [...filtered, { originalDate, alternative }];
    });
    // Remove from skipped dates if it was there
    setSkippedDates((prev) =>
      prev.filter((d) => d.toDateString() !== originalDate.toDateString())
    );
  };

  // Handle skipping a date
  const handleSkipDate = (date: Date) => {
    setSkippedDates((prev) => {
      if (prev.some((d) => d.toDateString() === date.toDateString())) {
        return prev;
      }
      return [...prev, date];
    });
    // Remove from selected alternatives if it was there
    setSelectedAlternatives((prev) =>
      prev.filter((sa) => sa.originalDate.toDateString() !== date.toDateString())
    );
  };

  const onSubmit = async (data: AppointmentFormData) => {
    setIsSubmitting(true);

    try {
      let clientId = data.clientId;

      // If walk-in, create the walk-in client first
      if (isWalkIn && mode === "create") {
        if (!walkInName.trim()) {
          toast.error("Please enter the walk-in client's name");
          setIsSubmitting(false);
          return;
        }

        const walkInResult = await createWalkInClient({
          firstName: walkInName.trim(),
          phone: walkInPhone.trim() || undefined,
        });

        if (!walkInResult.success) {
          toast.error(walkInResult.error);
          setIsSubmitting(false);
          return;
        }

        clientId = walkInResult.data.id;
        toast.success(`Walk-in client "${walkInResult.data.firstName}" created`);
      }

      if (mode === "create") {
        // Handle recurring appointments
        if (isRecurring) {
          const startTime = data.startTime instanceof Date ? data.startTime : new Date(data.startTime);
          const result = await createRecurringSeries({
            clientId,
            serviceId: data.serviceId,
            staffId: data.staffId,
            pattern: recurrencePattern,
            customWeeks: recurrencePattern === "CUSTOM" ? customWeeks : undefined,
            dayOfWeek: recurrencePattern === "SPECIFIC_DAYS" ? specificDays[0] ?? startTime.getDay() : startTime.getDay(),
            timeOfDay: format(startTime, "HH:mm"),
            specificDays: recurrencePattern === "SPECIFIC_DAYS" ? specificDays : undefined,
            nthWeek: recurrencePattern === "NTH_WEEKDAY" ? nthWeek : undefined,
            endType,
            endAfterCount: endType === "AFTER_COUNT" ? endAfterCount : undefined,
            endByDate: endType === "BY_DATE" ? endByDate : undefined,
            lockedPrice: lockedPrice,
            bufferMinutes: bufferMinutes > 0 ? bufferMinutes : undefined,
            notes: data.notes,
          });

          if (result.success) {
            const { createdCount, skippedDates } = result.data;
            if (skippedDates.length > 0) {
              toast.success(
                `Created ${createdCount} recurring appointments. ${skippedDates.length} dates skipped due to conflicts.`
              );
            } else {
              toast.success(`Created ${createdCount} recurring appointments`);
            }
            router.push("/dashboard/appointments");
          } else {
            toast.error(result.error);
          }
        } else {
          const result = await createAppointment({ ...data, clientId });
          if (result.success) {
            toast.success("Appointment booked successfully");
            router.push("/dashboard/appointments");
          } else {
            toast.error(result.error);
          }
        }
      } else if (appointment) {
        const result = await updateAppointment(appointment.id, data);
        if (result.success) {
          toast.success("Appointment updated successfully");
          router.push("/dashboard/appointments");
        } else {
          toast.error(result.error);
        }
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      // Reset time slot selection when date changes
      const currentTime = watchedStartTime instanceof Date ? new Date(watchedStartTime) : new Date();
      currentTime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      setValue("startTime", currentTime);
    }
  };

  const handleTimeSlotSelect = (slot: { startTime: Date; endTime: Date }) => {
    setValue("startTime", slot.startTime);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Client & Service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Walk-in Toggle - Only show in create mode */}
          {mode === "create" && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!isWalkIn ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsWalkIn(false);
                  setWalkInName("");
                  setWalkInPhone("");
                }}
                className="flex-1"
              >
                <Users className="h-4 w-4 mr-2" />
                Existing Client
              </Button>
              <Button
                type="button"
                variant={isWalkIn ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsWalkIn(true);
                  // Clear validation errors for clientId when in walk-in mode
                  setValue("clientId", "", { shouldValidate: false });
                }}
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Walk-in Client
              </Button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Client Selection - Show based on walk-in toggle */}
            {!isWalkIn ? (
              <div className="space-y-2">
                <Label htmlFor="clientId">Client *</Label>
                <Select
                  value={watch("clientId")}
                  onValueChange={(value) => setValue("clientId", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.firstName} {client.lastName || ""} {client.phone ? `- ${client.phone}` : ""}
                        {client.isWalkIn && " (Walk-in)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.clientId && !isWalkIn && (
                  <p className="text-sm text-destructive">{errors.clientId.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="walkInName">Client Name *</Label>
                <Input
                  id="walkInName"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="Enter client's name"
                />
              </div>
            )}

            {/* Walk-in Phone (optional) - only show in walk-in mode */}
            {isWalkIn ? (
              <div className="space-y-2">
                <Label htmlFor="walkInPhone">Phone (Optional)</Label>
                <Input
                  id="walkInPhone"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="Enter phone number"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="serviceId">Service *</Label>
                <Select
                  value={watch("serviceId")}
                  onValueChange={(value) => setValue("serviceId", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name} ({service.duration} min - ${Number(service.price).toFixed(2)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.serviceId && (
                  <p className="text-sm text-destructive">{errors.serviceId.message}</p>
                )}
              </div>
            )}
          </div>

          {/* Service selection for walk-in mode */}
          {isWalkIn && (
            <div className="space-y-2">
              <Label htmlFor="serviceId">Service *</Label>
              <Select
                value={watch("serviceId")}
                onValueChange={(value) => setValue("serviceId", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name} ({service.duration} min - ${Number(service.price).toFixed(2)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.serviceId && (
                <p className="text-sm text-destructive">{errors.serviceId.message}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="staffId">Staff Member *</Label>
            <Select
              value={watch("staffId")}
              onValueChange={(value) => setValue("staffId", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.firstName} {member.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.staffId && (
              <p className="text-sm text-destructive">{errors.staffId.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date & Time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {watchedStaffId && watchedServiceId && selectedDate && (
            <div className="space-y-2">
              <Label>Available Time Slots</Label>
              {isLoadingSlots ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : availableSlots.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {availableSlots.map((slot, index) => {
                    const isSelected =
                      watchedStartTime instanceof Date &&
                      new Date(watchedStartTime).getTime() === new Date(slot.startTime).getTime();
                    return (
                      <Button
                        key={index}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleTimeSlotSelect(slot)}
                        className="text-xs"
                      >
                        {format(new Date(slot.startTime), "h:mm a")}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No available time slots for this date. Please select a different date or staff
                  member.
                </p>
              )}
              {errors.startTime && (
                <p className="text-sm text-destructive">{errors.startTime.message}</p>
              )}
            </div>
          )}

          {(!watchedStaffId || !watchedServiceId) && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Please select a client, service, and staff member to view available time slots.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recurring Appointment Section - Only in create mode */}
      {mode === "create" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                <CardTitle>Recurring Appointment</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="recurring-toggle" className="text-sm font-normal">
                  Make this recurring
                </Label>
                <Switch
                  id="recurring-toggle"
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                />
              </div>
            </div>
          </CardHeader>
          {isRecurring && (
            <CardContent className="space-y-6">
              {/* Pattern Selector */}
              <PatternSelector
                pattern={recurrencePattern}
                onPatternChange={setRecurrencePattern}
                customWeeks={customWeeks}
                onCustomWeeksChange={setCustomWeeks}
                specificDays={specificDays}
                onSpecificDaysChange={setSpecificDays}
                dayOfWeek={dayOfWeek}
                onDayOfWeekChange={setDayOfWeek}
                nthWeek={nthWeek}
                onNthWeekChange={setNthWeek}
              />

              {/* End Condition Selector */}
              <EndConditionSelector
                endType={endType}
                onEndTypeChange={setEndType}
                endAfterCount={endAfterCount}
                onEndAfterCountChange={setEndAfterCount}
                endByDate={endByDate}
                onEndByDateChange={setEndByDate}
                minDate={selectedDate || new Date()}
              />

              {/* Advanced Options */}
              <div className="space-y-4 pt-4 border-t">
                <Label className="text-sm font-medium">Advanced Options</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Lock Price */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="lockedPrice" className="text-sm">Lock Price</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Lock the price for all appointments in this series. Leave empty to use current service price.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="lockedPrice"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="Use current price"
                        value={lockedPrice ?? ""}
                        onChange={(e) => setLockedPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
                        className="pl-7"
                      />
                    </div>
                  </div>

                  {/* Buffer Minutes */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="bufferMinutes" className="text-sm">Buffer Time</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Add extra time after each appointment for cleanup, preparation, or breaks.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Select
                      value={bufferMinutes.toString()}
                      onValueChange={(value) => setBufferMinutes(parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No buffer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">No buffer</SelectItem>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Preview of generated dates */}
              {previewDates.length > 0 && !!watchedStartTime && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Preview</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Appointments will be created based on the pattern and end condition.
                              Click &quot;Check Availability&quot; to see conflicts before creating.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="rounded-lg border p-3 bg-muted/50">
                      <div className="flex flex-wrap gap-2">
                        {previewDates.map((date, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {format(date, "MMM d")}
                          </Badge>
                        ))}
                        {previewDates.length >= 6 && endType !== "AFTER_COUNT" && (
                          <Badge variant="outline" className="text-xs">
                            + more
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {getPatternSummary(recurrencePattern, {
                          customWeeks,
                          specificDays,
                          dayOfWeek,
                          nthWeek,
                        })}
                        {" at "}
                        {watchedStartTime instanceof Date
                          ? format(watchedStartTime, "h:mm a")
                          : format(new Date(watchedStartTime as string | number), "h:mm a")}
                        {" \u2022 "}
                        {getEndConditionSummary(endType, { endAfterCount, endByDate })}
                      </p>
                    </div>
                  </div>

                  {/* Check Availability Button */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreviewConflicts}
                    disabled={isPreviewingConflicts || !watchedServiceId || !watchedStaffId}
                    className="w-full"
                  >
                    {isPreviewingConflicts ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking availability...
                      </>
                    ) : conflictPreview ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Re-check Availability
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Check Availability
                      </>
                    )}
                  </Button>

                  {/* Conflict Preview Results */}
                  {conflictPreview && (
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="rounded-lg border p-3 bg-muted/30">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                              <div className="h-2 w-2 rounded-full bg-green-500" />
                              <span className="text-muted-foreground">Available:</span>
                              <span className="font-medium">{conflictPreview.availableDates.length}</span>
                            </span>
                            {conflictPreview.conflicts.length > 0 && (
                              <span className="flex items-center gap-1">
                                <div className="h-2 w-2 rounded-full bg-yellow-500" />
                                <span className="text-muted-foreground">Conflicts:</span>
                                <span className="font-medium">{conflictPreview.conflicts.length}</span>
                              </span>
                            )}
                            {(selectedAlternatives.length > 0 || skippedDates.length > 0) && (
                              <span className="flex items-center gap-1">
                                <div className="h-2 w-2 rounded-full bg-blue-500" />
                                <span className="text-muted-foreground">Resolved:</span>
                                <span className="font-medium">{selectedAlternatives.length + skippedDates.length}</span>
                              </span>
                            )}
                          </div>
                          <span className="text-muted-foreground">
                            Total: {conflictPreview.totalDates}
                          </span>
                        </div>
                      </div>

                      {/* Conflict Resolution UI */}
                      {conflictPreview.conflicts.length > 0 && (
                        <ConflictResolutionUI
                          conflicts={conflictPreview.conflicts.map((c) => ({
                            date: new Date(c.date),
                            reason: c.reason,
                            alternatives: c.alternatives.map((a) => ({
                              date: new Date(c.date),
                              startTime: new Date(a.startTime),
                              endTime: new Date(a.endTime),
                              staffId: a.staffId,
                              staffName: a.staffName,
                            })),
                          }))}
                          onSelectAlternative={handleSelectAlternative}
                          onSkipDate={handleSkipDate}
                          selectedAlternatives={selectedAlternatives}
                          skippedDates={skippedDates}
                          showAllDates
                        />
                      )}

                      {/* All clear message */}
                      {conflictPreview.conflicts.length === 0 && (
                        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-4 text-center">
                          <Check className="h-8 w-8 mx-auto text-green-600 mb-2" />
                          <p className="font-medium text-green-800 dark:text-green-200">
                            All {conflictPreview.totalDates} dates are available!
                          </p>
                          <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                            No scheduling conflicts found. You can proceed to create the series.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Additional Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              {...register("notes")}
              placeholder="Any special requests or notes..."
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.notes && (
              <p className="text-sm text-destructive">{errors.notes.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create"
            ? isRecurring
              ? "Create Recurring Series"
              : "Book Appointment"
            : "Update Appointment"}
        </Button>
      </div>
    </form>
  );
}
