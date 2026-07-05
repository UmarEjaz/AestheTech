"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { formatInTz } from "@/lib/utils/timezone";

// Anchor a picked calendar day (its Y/M/D as the user saw it) to NOON in the salon
// timezone, so slot lookups resolve to the salon's day regardless of the browser's
// timezone. Noon keeps it well clear of midnight/DST boundaries.
function salonDayAnchor(date: Date, tz: string): Date {
  return new TZDate(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0, tz);
}

// Turn an instant into a "floating" local Date whose Y/M/D equals that instant's
// SALON-timezone calendar day. The date-picker then displays/selects the salon day
// no matter what timezone the staff member's computer is set to.
function toSalonLocalDay(instant: Date, tz: string): Date {
  const z = new TZDate(instant, tz);
  return new Date(z.getFullYear(), z.getMonth(), z.getDate());
}
import { Loader2, Calendar as CalendarIcon, UserPlus, Users, Repeat, Info, DollarSign, Clock, AlertTriangle, Check, Wallet, ChevronsUpDown, Zap } from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { RecurrencePattern, RecurrenceEndType, PaymentMethod } from "@prisma/client";
import { SELECTABLE_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/constants/payment-methods";
import { PatternSelector, getPatternSummary } from "./pattern-selector";
import { EndConditionSelector, getEndConditionSummary } from "./end-condition-selector";
import {
  createAppointment,
  updateAppointment,
  getAvailableSlots,
  addAppointmentDeposit,
  AppointmentListItem,
} from "@/lib/actions/appointment";
import { createRecurringSeries, previewRecurringConflicts, getRecurringPreviewDates, ConflictPreview } from "@/lib/actions/recurring-series";
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
  defaultClientType?: "EXISTING" | "WALK_IN";
  timezone?: string;
}

export function AppointmentForm({
  mode,
  appointment,
  clients,
  services,
  staff,
  initialDate,
  defaultClientType = "EXISTING",
  timezone = "UTC",
}: AppointmentFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    toSalonLocalDay(
      appointment ? new Date(appointment.startTime) : initialDate ?? new Date(),
      timezone
    )
  );
  const [availableSlots, setAvailableSlots] = useState<{ startTime: Date; endTime: Date }[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Walk-in client state — starts on the salon's configured default tab (create mode only).
  const [isWalkIn, setIsWalkIn] = useState(mode === "create" && defaultClientType === "WALK_IN");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  // Optional deposit collected at booking time (non-recurring only)
  const [collectDeposit, setCollectDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>(PaymentMethod.CASH);

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
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<AppointmentFormInput, unknown, AppointmentFormData>({
    // clientId isn't required at the resolver level because a Walk-in booking has no
    // clientId (it's created on submit). The "existing client selected" check is done
    // in onSubmit instead, so switching to Walk-in no longer blocks submission.
    resolver: zodResolver(appointmentSchema.extend({ clientId: z.string() })),
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
        setSpecificDays((prev) => [...new Set([...prev, selectedDate.getDay()])]);
      }
    }
  }, [selectedDate, recurrencePattern, specificDays]);

  // Preview dates state (fetched from server for accuracy)
  const [previewDates, setPreviewDates] = useState<Date[]>([]);

  // Fetch preview dates from server using the same logic as actual creation
  useEffect(() => {
    if (!isRecurring || !watchedStartTime) {
      setPreviewDates([]);
      return;
    }

    const startDate = watchedStartTime instanceof Date ? watchedStartTime : new Date(watchedStartTime as string | number);

    // Debounce the server call
    const timeoutId = setTimeout(async () => {
      try {
        const result = await getRecurringPreviewDates({
          pattern: recurrencePattern,
          startDate,
          timeOfDay: formatInTz(startDate, "HH:mm", timezone),
          dayOfWeek: recurrencePattern === "SPECIFIC_DAYS"
            ? specificDays[0] ?? dayOfWeek
            : dayOfWeek,
          customWeeks: recurrencePattern === "CUSTOM" ? customWeeks : undefined,
          specificDays: recurrencePattern === "SPECIFIC_DAYS" ? specificDays : undefined,
          nthWeek: recurrencePattern === "NTH_WEEKDAY" ? nthWeek : undefined,
          endType,
          endAfterCount: endType === "AFTER_COUNT" ? endAfterCount : undefined,
          endByDate: endType === "BY_DATE" ? endByDate : undefined,
          maxPreviewCount: 6,
          timeZone: timezone,
        });

        if (result.success) {
          setPreviewDates(result.data.dates.map(d => new Date(d)));
        }
      } catch (error) {
        console.error("Error fetching preview dates:", error);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [isRecurring, watchedStartTime, recurrencePattern, customWeeks, specificDays, nthWeek, dayOfWeek, endType, endAfterCount, endByDate, timezone]);

  // Fetch available slots when staff, service, or date changes
  useEffect(() => {
    const fetchSlots = async () => {
      if (!watchedStaffId || !watchedServiceId || !selectedDate) return;

      setIsLoadingSlots(true);
      try {
        const result = await getAvailableSlots({
          staffId: watchedStaffId,
          // Resolve slots for the salon's calendar day, not the browser's.
          date: salonDayAnchor(selectedDate, timezone),
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
  }, [watchedStaffId, watchedServiceId, selectedDate, mode, appointment?.id, timezone]);

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
        dayOfWeek: recurrencePattern === "SPECIFIC_DAYS"
          ? specificDays[0] ?? dayOfWeek
          : dayOfWeek,
        timeOfDay: formatInTz(startTime, "HH:mm", timezone),
        startDate: startTime,
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

  // Walk-in is here right now: book at the current time (bypassing the slot grid and
  // business hours) and go straight to checkout so they can pay and start immediately.
  const handleWalkInNow = async () => {
    const serviceId = watch("serviceId");
    const staffId = watch("staffId");
    if (!walkInName.trim()) {
      toast.error("Please enter the walk-in client's name");
      return;
    }
    if (!serviceId) {
      toast.error("Please select a service");
      return;
    }
    if (!staffId) {
      toast.error("Please select a staff member");
      return;
    }

    setIsSubmitting(true);
    try {
      const walkInResult = await createWalkInClient({
        firstName: walkInName.trim(),
        phone: walkInPhone.trim() || undefined,
      });
      if (!walkInResult.success) {
        toast.error(walkInResult.error);
        setIsSubmitting(false);
        return;
      }

      const result = await createAppointment({
        clientId: walkInResult.data.id,
        serviceId,
        staffId,
        startTime: new Date(),
        notes: watch("notes") || undefined,
      });

      if (result.success) {
        toast.success(`Walk-in "${walkInResult.data.firstName}" booked — proceeding to checkout`);
        router.push(`/dashboard/sales/new?appointmentId=${result.data.id}`);
      } else {
        toast.error(result.error);
        setIsSubmitting(false);
      }
    } catch {
      toast.error("An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: AppointmentFormData) => {
    // Existing-client bookings need a selected client (walk-ins don't — created below).
    if (!isWalkIn && !data.clientId) {
      setError("clientId", { message: "Client is required" });
      return;
    }
    // A time slot must be explicitly chosen — otherwise startTime silently defaults to
    // "now", which can land outside business hours and become invisible on the calendar.
    if (mode === "create") {
      const chosenMs =
        data.startTime instanceof Date ? data.startTime.getTime() : new Date(data.startTime).getTime();
      const slotChosen = availableSlots.some((s) => new Date(s.startTime).getTime() === chosenMs);
      if (!slotChosen) {
        setSlotError("Please select an available time slot");
        toast.error("Please select a time slot");
        return;
      }
    }
    setSlotError(null);
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
            dayOfWeek: recurrencePattern === "SPECIFIC_DAYS"
              ? specificDays[0] ?? dayOfWeek
              : dayOfWeek,
            timeOfDay: formatInTz(startTime, "HH:mm", timezone),
            startDate: startTime,
            specificDays: recurrencePattern === "SPECIFIC_DAYS" ? specificDays : undefined,
            nthWeek: recurrencePattern === "NTH_WEEKDAY" ? nthWeek : undefined,
            endType,
            endAfterCount: endType === "AFTER_COUNT" ? endAfterCount : undefined,
            endByDate: endType === "BY_DATE" ? endByDate : undefined,
            lockedPrice: lockedPrice,
            bufferMinutes: bufferMinutes > 0 ? bufferMinutes : undefined,
            notes: data.notes,
            // Pass user conflict resolution choices
            selectedAlternatives: selectedAlternatives.length > 0 ? selectedAlternatives : undefined,
            skipDates: skippedDates.length > 0 ? skippedDates : undefined,
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
            // Optionally record a deposit taken at booking time.
            const depositValue = Number(depositAmount);
            if (collectDeposit && Number.isFinite(depositValue) && depositValue > 0) {
              const depositResult = await addAppointmentDeposit(result.data.id, {
                amount: depositValue,
                method: depositMethod,
              });
              if (depositResult.success) {
                toast.success(
                  `Appointment booked · $${depositValue.toFixed(2)} deposit recorded`
                );
              } else {
                toast.warning(
                  `Appointment booked, but the deposit couldn't be recorded (${depositResult.error}). Add it from the appointment.`
                );
              }
            } else {
              toast.success("Appointment booked successfully");
            }
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
    setSlotError(null);
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
                onClick={() => setIsWalkIn(false)}
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
                  // Don't wipe the entered data — just drop the "client required" error
                  // so it doesn't linger on the Walk-in tab.
                  clearErrors("clientId");
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
                {(() => {
                  const selectedClientId = watch("clientId");
                  const selectedClient = clients.find((c) => c.id === selectedClientId);
                  return (
                    <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={clientPickerOpen}
                          className="w-full justify-between font-normal"
                        >
                          <span className={cn("truncate", !selectedClient && "text-muted-foreground")}>
                            {selectedClient
                              ? `${selectedClient.firstName} ${selectedClient.lastName || ""}`.trim() +
                                (selectedClient.phone ? ` · ${selectedClient.phone}` : "")
                              : "Select a client"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search by name or phone..." />
                          <CommandList>
                            <CommandEmpty>No client found.</CommandEmpty>
                            <CommandGroup>
                              {clients.map((client) => {
                                const label = `${client.firstName} ${client.lastName || ""}`.trim();
                                return (
                                  <CommandItem
                                    key={client.id}
                                    value={`${label} ${client.phone || ""}`}
                                    onSelect={() => {
                                      setValue("clientId", client.id, { shouldValidate: false });
                                      clearErrors("clientId");
                                      setClientPickerOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        selectedClientId === client.id ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <span className="truncate">
                                      {label}
                                      {client.phone ? ` · ${client.phone}` : ""}
                                      {client.isWalkIn && " (Walk-in)"}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  );
                })()}
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
            {staff.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No service providers found. Mark a staff member as a{" "}
                <span className="font-medium text-foreground">Service Provider</span> on the{" "}
                <Link href="/dashboard/staff" className="font-medium text-primary underline underline-offset-2">
                  Staff
                </Link>{" "}
                page to book appointments.
              </p>
            ) : (
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
            )}
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
          {/* Walk-in is here right now — skip the slot grid, book at current time, go to checkout */}
          {isWalkIn && mode === "create" && !isRecurring && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <Zap className="h-4 w-4 text-primary" />
                  Client is here right now?
                </p>
                <p className="text-sm text-muted-foreground">
                  Books at the current time and takes you straight to checkout.
                </p>
              </div>
              <Button
                type="button"
                onClick={handleWalkInNow}
                disabled={isSubmitting}
                className="shrink-0"
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                Walk in now
              </Button>
            </div>
          )}

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
                  // Highlight "today" by the salon timezone, not the computer's.
                  today={toSalonLocalDay(new Date(), timezone)}
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  disabled={(date) => {
                    // Disable days before "today" in the SALON timezone (compare by
                    // calendar-day components so the browser's tz doesn't shift it).
                    const salonNow = new TZDate(new Date(), timezone);
                    const salonToday = new Date(
                      salonNow.getFullYear(),
                      salonNow.getMonth(),
                      salonNow.getDate()
                    );
                    const cell = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    return cell < salonToday;
                  }}
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
                    // Slots earlier than "now" (only possible for today) can't be booked.
                    const isPast = new Date(slot.startTime).getTime() < Date.now();
                    return (
                      <Button
                        key={index}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        disabled={isPast}
                        title={isPast ? "This time has already passed" : undefined}
                        onClick={() => handleTimeSlotSelect(slot)}
                        className="text-xs"
                      >
                        {formatInTz(slot.startTime, "h:mm a", timezone)}
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
              {(errors.startTime || slotError) && (
                <p className="text-sm text-destructive">{errors.startTime?.message || slotError}</p>
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
                            {formatInTz(date, "MMM d", timezone)}
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
                          ? formatInTz(watchedStartTime, "h:mm a", timezone)
                          : formatInTz(new Date(watchedStartTime as string | number), "h:mm a", timezone)}
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

      {/* Deposit Section — last, right before the action buttons */}
      {mode === "create" && !isRecurring && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                <CardTitle>Deposit</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="deposit-toggle" className="text-sm font-normal">
                  Collect a deposit now
                </Label>
                <Switch
                  id="deposit-toggle"
                  checked={collectDeposit}
                  onCheckedChange={setCollectDeposit}
                />
              </div>
            </div>
          </CardHeader>
          {collectDeposit && (
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Prepayment held against this appointment. It&apos;s applied toward the total at
                checkout — you only collect the remaining balance on the day.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="depositAmount">Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="depositAmount"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="depositMethod">Method</Label>
                  <Select
                    value={depositMethod}
                    onValueChange={(v) => setDepositMethod(v as PaymentMethod)}
                  >
                    <SelectTrigger id="depositMethod">
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
            </CardContent>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-4">
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
