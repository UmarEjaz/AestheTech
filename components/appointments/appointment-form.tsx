"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { formatInTz } from "@/lib/utils/timezone";
import { type BookingMode } from "@/lib/constants/booking-modes";

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

// Turn a "yyyy-MM-dd" salon-day string into a floating local Date (same shape as toSalonLocalDay),
// so the date-picker + slot fetch treat it as that salon calendar day regardless of browser tz.
function localDayFromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
import { Loader2, Calendar as CalendarIcon, UserPlus, Repeat, Info, DollarSign, Clock, AlertTriangle, Check, Wallet, ChevronsUpDown, ChevronUp, ChevronDown, Plus, X, Star, Pencil, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCustomTimeCheck } from "./use-custom-time-check";
import { createRecurringSeries, previewRecurringConflicts, getRecurringPreviewDates, ConflictPreview } from "@/lib/actions/recurring-series";
import { ConflictResolutionUI, AlternativeSlot, SelectedAlternative } from "./conflict-resolution-ui";
import { createBookingClient, getClientBookingContext, updateClient, getClients, ClientBookingContext } from "@/lib/actions/client";
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

interface SelectOption {
  value: string;
  label: string;
}

// A searchable single-select combobox (Popover + Command). Scales past a plain <Select>
// for salons with long service/staff lists — you type to filter instead of scrolling.
function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText = "No match.",
  triggerId,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText?: string;
  triggerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => { onValueChange(o.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Form-local schema. Services (1..N, each with its own staff) are managed uniformly in the
// `services` state array — index 0 is the primary. clientId is relaxed here (enforced
// per-tab in onSubmit); services are validated in onSubmit too.
const bookingFormSchema = z.object({
  clientId: z.string(),
  startTime: z.coerce.date({ message: "Start time is required" }),
  notes: z.string().trim().max(500, "Notes must be at most 500 characters").optional().or(z.literal("")),
});
type BookingFormInput = z.input<typeof bookingFormSchema>;
type BookingFormValues = z.infer<typeof bookingFormSchema>;

interface AppointmentFormProps {
  mode: "create" | "edit";
  appointment?: AppointmentListItem;
  services: Service[];
  staff: Staff[];
  initialDate?: Date;
  /** Pre-select this provider on the first service line (e.g. when booking from a staff lane). */
  initialStaffId?: string;
  defaultBookingMode?: BookingMode;
  timezone?: string;
  /** Whether the current user may take payments (sales:create). Hides the deposit toggle if not. */
  canTakeDeposit?: boolean;
}

export function AppointmentForm({
  mode,
  appointment,
  services,
  staff,
  initialDate,
  initialStaffId,
  defaultBookingMode = "APPOINTMENT",
  timezone = "UTC",
  canTakeDeposit = false,
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
  // Custom-time toggle state + its server validation live in useCustomTimeCheck (called below,
  // after `assignments` is derived). It owns customTime/customTimeMode/customTimeCheck.
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // Visit mode: "walkin" books at the current time (client is here now); "appointment"
  // picks a slot. Edit mode always behaves as an appointment (editing an existing slot).
  const [visitMode, setVisitMode] = useState<"walkin" | "appointment">(
    mode === "create" && defaultBookingMode === "WALK_IN" ? "walkin" : "appointment"
  );

  // Unified client picker: pick an existing client (RHF clientId) OR add a new one inline.
  // The picker searches the DB on demand (debounced) — the page no longer loads every client.
  const [addingNewClient, setAddingNewClient] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  // The chosen client (for display), independent of the current search results. In edit mode we
  // seed it from the appointment's client so its name shows immediately.
  const [selectedClientObj, setSelectedClientObj] = useState<Client | null>(
    mode === "edit" && appointment
      ? {
          id: appointment.client.id,
          firstName: appointment.client.firstName,
          lastName: appointment.client.lastName,
          phone: appointment.client.phone,
          isWalkIn: appointment.client.isWalkIn,
        }
      : null
  );
  const [newClient, setNewClient] = useState({ name: "", phone: "", email: "" });
  const [clientError, setClientError] = useState<string | null>(null);
  const isWalkIn = visitMode === "walkin";

  useEffect(() => {
    if (!clientPickerOpen) return;
    let active = true;
    const t = setTimeout(async () => {
      const res = await getClients({ query: clientQuery.trim() || undefined, limit: 20 });
      if (!active) return;
      if (res.success) {
        setClientResults(
          res.data.clients.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            phone: c.phone,
            isWalkIn: c.isWalkIn,
          }))
        );
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [clientQuery, clientPickerOpen]);

  // At-a-glance context for the selected existing client (loyalty tier/points, last visit,
  // allergy flag, no-shows). Fetched on demand — see the effect below. Every field degrades
  // to nothing when it doesn't apply (e.g. loyalty === null when the salon has loyalty off).
  const [clientCtx, setClientCtx] = useState<ClientBookingContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  // Inline "edit contact" popover (add/fix phone & email without leaving the booking flow).
  const [editingContact, setEditingContact] = useState(false);
  const [editContact, setEditContact] = useState({ phone: "", email: "" });
  const [savingContact, setSavingContact] = useState(false);

  // Optional deposit collected at booking time (non-recurring only)
  const [collectDeposit, setCollectDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [depositError, setDepositError] = useState<string | null>(null);

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
  } = useForm<BookingFormInput, unknown, BookingFormValues>({
    // clientId isn't required at the resolver level because a Walk-in booking has no
    // clientId (it's created on submit). The "existing client selected" check is done
    // in onSubmit instead, so switching to Walk-in no longer blocks submission.
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      clientId: appointment?.clientId || "",
      startTime: appointment ? new Date(appointment.startTime) : initialDate || new Date(),
      notes: appointment?.notes || "",
    },
  });

  // The chosen services on the appointment (1..N), each with its own staff. Index 0 = primary.
  // Named serviceLines to avoid colliding with the `services` prop (list of available services).
  const [serviceLines, setServiceLines] = useState<{ serviceId: string; staffId: string }[]>(
    appointment && appointment.services.length > 0
      ? appointment.services.map((s) => ({ serviceId: s.service.id, staffId: s.staff.id }))
      : [{ serviceId: "", staffId: initialStaffId ?? "" }]
  );
  const [servicesError, setServicesError] = useState<string | null>(null);

  // Primary = first service. Drives the calendar lane, slot staff, and recurring series.
  const primaryServiceId = serviceLines[0]?.serviceId ?? "";
  const primaryStaffId = serviceLines[0]?.staffId ?? "";

  // Services are a bounded menu (like products), so they're loaded up front and filtered in the
  // browser — instant, and nothing can slip past a list cap.
  const serviceOptions: SelectOption[] = services.map((s) => ({
    value: s.id,
    label: `${s.name} (${s.duration} min - $${Number(s.price).toFixed(2)})`,
  }));
  const staffOptions: SelectOption[] = staff.map((m) => ({
    value: m.id,
    label: `${m.firstName} ${m.lastName}`,
  }));

  const watchedStartTime = watch("startTime");
  const selectedClientId = watch("clientId");

  // True when `when` matches one of the currently available time slots. Used in three places
  // (submit validation, the Book-button readiness, and the summary card) — keeping it in one helper
  // stops those copies from drifting apart.
  const slotIsChosen = (when: Date | string | number): boolean => {
    const ms = when instanceof Date ? when.getTime() : new Date(when).getTime();
    return availableSlots.some((s) => new Date(s.startTime).getTime() === ms);
  };

  // Load the selected client's booking context (loyalty/last-visit/allergy/no-shows) on
  // demand — only for the chosen client, never the whole list (scales to huge client books).
  useEffect(() => {
    if (!selectedClientId) {
      setClientCtx(null);
      setCtxLoading(false);
      return;
    }
    let cancelled = false;
    setCtxLoading(true);
    getClientBookingContext(selectedClientId)
      .then((res) => {
        if (cancelled) return;
        setClientCtx(res.success ? res.data : null);
      })
      .finally(() => {
        if (!cancelled) setCtxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

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

  // Ordered service→staff assignments. Slots are validated per-provider-per-segment server-side,
  // so each provider is only busy for the slice they'd work.
  const assignments = useMemo(
    () =>
      serviceLines
        .filter((s) => s.serviceId && s.staffId)
        .map((s) => ({ serviceId: s.serviceId, staffId: s.staffId })),
    [serviceLines]
  );
  // Stable string key of the assignments for the effect dependency.
  const assignmentsKey = assignments.map((s) => `${s.serviceId}:${s.staffId}`).join(",");

  // "Custom time" toggle: type any minute (e.g. 9:20) instead of a listed slot, server-validated
  // and guarded against stale/out-of-order answers. See use-custom-time-check.ts.
  const {
    customTime,
    customTimeMode,
    customTimeCheck,
    customTimeReady,
    applyCustomTime,
    setCustomTimeMode: handleCustomTimeMode,
    clearForSlot: clearCustomTimeForSlot,
  } = useCustomTimeCheck({
    assignments,
    selectedDate,
    timezone,
    mode,
    appointmentId: appointment?.id,
    getStartTime: () => (watchedStartTime instanceof Date ? watchedStartTime : undefined),
    setStartTime: (instant) =>
      setValue("startTime", instant as unknown as Date, { shouldValidate: false }),
    setSelectedDate,
    clearSlotError: () => setSlotError(null),
  });

  // Fetch available slots when the service/staff assignments or date change
  useEffect(() => {
    let cancelled = false;
    const fetchSlots = async () => {
      // Clear stale slots whenever inputs change so the grid + submit can't validate against
      // a previous date's times.
      if (assignments.length === 0 || !selectedDate) {
        setAvailableSlots([]);
        return;
      }

      setIsLoadingSlots(true);
      setAvailableSlots([]);
      try {
        const result = await getAvailableSlots({
          assignments,
          // Resolve slots for the salon's calendar day, not the browser's.
          date: salonDayAnchor(selectedDate, timezone),
          // In edit mode, exclude the current appointment from conflict check
          excludeAppointmentId: mode === "edit" ? appointment?.id : undefined,
        });
        // Ignore this response if a newer fetch has started (older response must not win).
        if (cancelled) return;
        if (result.success) {
          setAvailableSlots(result.data);
        }
      } finally {
        if (!cancelled) setIsLoadingSlots(false);
      }
    };

    fetchSlots();
    return () => {
      cancelled = true;
    };
    // assignmentsKey is the stable string form of `assignments`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentsKey, selectedDate, mode, appointment?.id, timezone]);

  // Auto-select the matching time slot when slots load
  useEffect(() => {
    if (availableSlots.length === 0) return;
    if (customTime || customTimeMode) return; // a typed/custom-mode time wins — don't overwrite it when slots reload

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
  }, [availableSlots, initialDate, mode, appointment, setValue, customTime, customTimeMode]);

  // Reset conflict preview when recurring settings change
  useEffect(() => {
    setConflictPreview(null);
    setSelectedAlternatives([]);
    setSkippedDates([]);
  }, [recurrencePattern, customWeeks, specificDays, nthWeek, endType, endAfterCount, endByDate, watchedStartTime, primaryStaffId, primaryServiceId]);

  // Handle conflict preview
  const handlePreviewConflicts = async () => {
    if (!primaryServiceId || !primaryStaffId || !watchedStartTime) {
      toast.error("Please select service, staff, and time first");
      return;
    }

    // The preview only checks staff/time conflicts, so a placeholder client id is fine
    // when the client is new (not yet created) or not chosen.
    const clientId = watch("clientId") || "preview-placeholder";

    setIsPreviewingConflicts(true);
    try {
      const startTime = watchedStartTime instanceof Date ? watchedStartTime : new Date(watchedStartTime as string | number);
      const result = await previewRecurringConflicts({
        clientId: clientId || "placeholder",
        serviceId: primaryServiceId,
        staffId: primaryStaffId,
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

  // Validate the services list: at least one, every row must have a service AND a staff.
  // Returns the array, or null (and sets an inline error) if incomplete.
  const buildServices = (): { serviceId: string; staffId: string }[] | null => {
    // Recurring series are single-service — only the first line applies.
    const lines = isRecurring ? serviceLines.slice(0, 1) : serviceLines;
    if (lines.length === 0) {
      setServicesError("Add at least one service");
      return null;
    }
    for (const s of lines) {
      if (!s.serviceId || !s.staffId) {
        setServicesError("Choose a service and staff for every line");
        return null;
      }
    }
    setServicesError(null);
    return lines.map((s) => ({ serviceId: s.serviceId, staffId: s.staffId }));
  };

  // Resolve the client for submission: an existing selection, OR create a new one inline.
  // Returns null (and surfaces an error) if the client is missing/incomplete.
  const resolveClientId = async (): Promise<string | null> => {
    if (addingNewClient) {
      const name = newClient.name.trim();
      if (!name) {
        setClientError("Enter the new client's name");
        return null;
      }
      const parts = name.split(/\s+/);
      const res = await createBookingClient({
        firstName: parts[0],
        lastName: parts.slice(1).join(" ") || undefined,
        phone: newClient.phone.trim() || undefined,
        email: newClient.email.trim() || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      // Persist the newly created client and leave "add new" mode, so if the booking itself fails
      // (conflict, etc.) a retry reuses this client instead of creating a duplicate record.
      setValue("clientId", res.data.id, { shouldValidate: false });
      setAddingNewClient(false);
      return res.data.id;
    }
    const cid = watch("clientId");
    if (!cid) {
      setClientError("Choose or add a client");
      return null;
    }
    return cid;
  };

  // Switch the client picker into "add new" mode, pre-filling name or phone from the search.
  const startAddNewClient = () => {
    const q = clientQuery.trim();
    const looksLikePhone = /^[\d\s\-+()]{4,}$/.test(q);
    setNewClient({ name: looksLikePhone ? "" : q, phone: looksLikePhone ? q : "", email: "" });
    setValue("clientId", "", { shouldValidate: false });
    setAddingNewClient(true);
    setClientPickerOpen(false);
    setClientError(null);
  };

  // Open the inline contact editor, seeding it with the client's current phone/email.
  const openContactEditor = () => {
    setEditContact({ phone: clientCtx?.phone ?? "", email: clientCtx?.email ?? "" });
    setEditingContact(true);
  };

  // Save an inline phone/email edit for the selected client, then refresh the strip so the
  // change shows immediately (instant feedback — no page reload, no leaving the booking flow).
  const saveContact = async () => {
    if (!selectedClientId) return;
    const phone = editContact.phone.trim();
    const email = editContact.email.trim();
    setSavingContact(true);
    try {
      const res = await updateClient({
        id: selectedClientId,
        // Only send phone when non-empty — the full client schema requires a valid phone,
        // so this editor adds/corrects a number but never blanks it out.
        ...(phone ? { phone } : {}),
        email,
      });
      if (!res.success) {
        toast.error(res.error || "Couldn't save contact details");
        return;
      }
      // Optimistically reflect the edit, then re-fetch for the source of truth.
      setClientCtx((prev) => (prev ? { ...prev, phone: phone || prev.phone, email } : prev));
      const refreshed = await getClientBookingContext(selectedClientId);
      if (refreshed.success) setClientCtx(refreshed.data);
      setEditingContact(false);
      toast.success("Contact details updated");
    } finally {
      setSavingContact(false);
    }
  };

  // Walk-in visit: book at the current time (bypassing the slot grid & business hours).
  // "checkout" goes straight to checkout; "only" just adds it to the calendar.
  const handleWalkInSubmit = async (action: "checkout" | "only") => {
    const services = buildServices();
    if (!services) {
      toast.error("Please choose a service and staff for every line");
      return;
    }
    setIsSubmitting(true);
    const clientId = await resolveClientId();
    if (!clientId) {
      setIsSubmitting(false);
      return;
    }
    try {
      const result = await createAppointment({
        clientId,
        services,
        startTime: new Date(),
        notes: watch("notes") || undefined,
      });
      if (result.success) {
        if (action === "checkout") {
          toast.success("Walk-in booked — proceeding to checkout");
          router.push(`/dashboard/sales/new?appointmentId=${result.data.id}`);
        } else {
          toast.success("Walk-in booked");
          router.push("/dashboard/appointments");
        }
      } else {
        toast.error(result.error);
        setIsSubmitting(false);
      }
    } catch {
      toast.error("An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: BookingFormValues) => {
    // Walk-in visits book at "now" via their own buttons; if the form is submitted while
    // in walk-in mode (e.g. the Enter key), route to the walk-in handler instead.
    if (visitMode === "walkin" && mode === "create") {
      handleWalkInSubmit("checkout");
      return;
    }

    // Merge primary + additional services; block if any row is incomplete.
    const services = buildServices();
    if (!services) {
      toast.error("Please choose a service and staff for every line");
      return;
    }
    // A time slot must be explicitly chosen — otherwise startTime silently defaults to
    // "now", which can land outside business hours and become invisible on the calendar.
    if (customTimeMode) {
      // A typed custom time must pass the server check (business hours, not past, no conflict) —
      // in BOTH create and edit mode, since the custom-time UI is available in both.
      if (customTimeCheck.status !== "ok") {
        const msg =
          customTimeCheck.status === "checking"
            ? "Still checking that time — one moment."
            : customTimeCheck.message ?? "Please enter a bookable custom time";
        setSlotError(msg);
        toast.error(msg);
        return;
      }
    } else if (mode === "create" && !slotIsChosen(data.startTime)) {
      setSlotError("Please select an available time slot");
      toast.error("Please select a time slot");
      return;
    }
    setSlotError(null);

    // If deposit collection is switched on, require a valid amount rather than silently
    // booking the appointment with no deposit.
    if (mode === "create" && !isRecurring && collectDeposit) {
      const d = Number(depositAmount);
      if (!Number.isFinite(d) || d <= 0) {
        setDepositError("Enter a deposit amount, or turn off “Collect a deposit now”.");
        toast.error("Enter a valid deposit amount");
        return;
      }
    }
    setDepositError(null);
    setIsSubmitting(true);

    try {
      // Existing selection or a freshly-created inline client.
      const clientId = await resolveClientId();
      if (!clientId) {
        setIsSubmitting(false);
        return;
      }

      if (mode === "create") {
        // Handle recurring appointments
        if (isRecurring) {
          const startTime = data.startTime instanceof Date ? data.startTime : new Date(data.startTime);
          const result = await createRecurringSeries({
            clientId,
            // Recurring series are single-service — use the primary service.
            serviceId: services[0].serviceId,
            staffId: services[0].staffId,
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
          const result = await createAppointment({ clientId, services, startTime: data.startTime, notes: data.notes });
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
        const result = await updateAppointment(appointment.id, {
          // Use the resolved id (handles a freshly-created inline client); data.clientId is
          // blanked while "add new client" is open.
          clientId,
          services,
          startTime: data.startTime,
          notes: data.notes,
        });
        if (result.success) {
          toast.success("Appointment updated successfully");
          router.push("/dashboard/appointments");
        } else {
          toast.error(result.error);
        }
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      // Keep the existing time-of-day but move it to the newly picked day, building the instant
      // in the SALON timezone (not the browser's) so edit-mode date changes don't shift the time.
      const base =
        watchedStartTime instanceof Date
          ? new TZDate(watchedStartTime, timezone)
          : new TZDate(new Date(), timezone);
      const startInstant = new TZDate(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        base.getHours(),
        base.getMinutes(),
        0,
        0,
        timezone
      );
      setValue("startTime", new Date(startInstant.getTime()));
    }
  };

  const handleTimeSlotSelect = (slot: { startTime: Date; endTime: Date }) => {
    clearCustomTimeForSlot(); // picking a listed slot clears any custom time
    setValue("startTime", slot.startTime);
    setSlotError(null);
  };
  // Header copy reflects the visit mode so the whole page reframes with the toggle:
  // "New Appointment" (for later) ⇄ "New Walk-in" (here now). Edit mode is always a slot.
  const headerTitle = mode === "edit" ? "Edit Appointment" : isWalkIn ? "New Walk-in" : "New Appointment";
  const headerSubtitle =
    mode === "edit"
      ? appointment
        ? `Update appointment for ${appointment.client.firstName}${appointment.client.lastName ? ` ${appointment.client.lastName}` : ""}${appointment.client.isWalkIn ? " (Walk-in)" : ""}`
        : "Update this appointment"
      : isWalkIn
        ? "Quick check-in for a walk-in client"
        : "Schedule a new appointment";

  // Booking readiness — drives the submit button's disabled state (plus a friendly hint) so
  // it's not a dead click that only complains via toast. A time slot is required only when
  // creating an appointment (walk-ins book at "now"; edit keeps its existing slot).
  const hasClient = addingNewClient ? newClient.name.trim().length > 0 : Boolean(selectedClientId);
  const readinessLines = isRecurring ? serviceLines.slice(0, 1) : serviceLines;
  const servicesComplete =
    readinessLines.length > 0 && readinessLines.every((l) => l.serviceId && l.staffId);
  const needsSlot = mode === "create" && !isWalkIn;
  // A start time is "set" when the field holds a real instant. Edit mode uses this instead of the
  // stricter listed-slot check, because an existing booking may sit at a custom minute that isn't one
  // of the listed slots — but it must still not be empty (e.g. after the custom-time toggle clears a
  // slot that belonged to a since-changed day, we must not let a blank time submit).
  const startTimeSet =
    watchedStartTime instanceof Date && !Number.isNaN(watchedStartTime.getTime());
  // Walk-ins book at "now", so they never need a chosen time. Otherwise, custom mode ALWAYS requires
  // a server-confirmed time (create AND edit) — evaluate it before the slot checks, else edit mode
  // would never require it. Create needs a listed slot; edit only needs a time to be set.
  const slotChosen = isWalkIn
    ? true
    : customTimeMode
      ? customTimeReady
      : needsSlot
        ? slotIsChosen(watchedStartTime as Date | string | number)
        : startTimeSet;
  // Walk-ins book at "now" (slotChosen is already true for them), so never surface custom-time hints
  // or block their booking even if stale custom-time state lingers — guard those branches with !isWalkIn.
  const bookingHint = !hasClient
    ? "Choose or add a client to continue"
    : !servicesComplete
      ? "Pick a service and staff for every line"
      : !isWalkIn && customTimeMode && customTimeCheck.status === "checking"
        ? "Checking that time…"
        : !isWalkIn && customTimeMode && customTimeCheck.status === "invalid"
          ? customTimeCheck.message ?? "Pick a bookable time"
          : !slotChosen
            ? customTimeMode
              ? "Enter a bookable custom time to continue"
              : "Select a time slot to continue"
            : null;
  const canBook = bookingHint === null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Page header — title/subtitle react to the visit mode. On desktop the Walk-in ⇄
          Appointment toggle sits on the right; on mobile it stacks under the title. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
            <Link href="/dashboard/appointments">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to appointments</span>
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold">{headerTitle}</h1>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              {headerSubtitle}
              {/* Tap-friendly (Popover, not a hover tooltip) so the cue works on tablets too. */}
              {mode === "create" && isWalkIn && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                      aria-label="How walk-in timing works"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 text-sm text-muted-foreground">
                    Walk-ins are booked in at the current time — no time slot to pick.
                  </PopoverContent>
                </Popover>
              )}
            </p>
          </div>
        </div>
        {mode === "create" && (
          // One control, announced as a radiogroup with two options (not three loose buttons).
          <div
            role="radiogroup"
            aria-label="Visit mode"
            className="flex shrink-0 items-center gap-3 self-start pl-14 sm:self-center sm:pl-0"
          >
            <button
              type="button"
              role="radio"
              aria-checked={isWalkIn}
              onClick={() => { setVisitMode("walkin"); setIsRecurring(false); }}
              className={cn("rounded text-right text-sm font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", isWalkIn ? "text-primary" : "text-muted-foreground")}
            >
              Walk-in
              <span className="block text-[11px] font-medium">here now</span>
            </button>
            {/* Decorative sliding track sized to match the shadcn Switch. The labels above are
                the real controls, so this is hidden from assistive tech (mouse convenience only). */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => { const next = isWalkIn ? "appointment" : "walkin"; setVisitMode(next); if (next === "walkin") setIsRecurring(false); }}
              className="relative h-6 w-11 shrink-0 rounded-full bg-primary"
            >
              <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all", isWalkIn ? "left-0.5" : "left-[22px]")} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isWalkIn}
              onClick={() => setVisitMode("appointment")}
              className={cn("rounded text-left text-sm font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", !isWalkIn ? "text-primary" : "text-muted-foreground")}
            >
              Appointment
              <span className="block text-[11px] font-medium">for later</span>
            </button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client & Service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Unified client picker: search an existing client OR add a new one inline.
              No Existing/New tabs — a regular who walks in is just found; a new face is added. */}
          {addingNewClient ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">New client</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setAddingNewClient(false); setClientError(null); }}
                >
                  ← Back to search
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nnName">Name *</Label>
                  <Input
                    id="nnName"
                    value={newClient.name}
                    onChange={(e) => { setNewClient((p) => ({ ...p, name: e.target.value })); setClientError(null); }}
                    placeholder="Client name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nnPhone">Phone</Label>
                  <Input
                    id="nnPhone"
                    value={newClient.phone}
                    onChange={(e) => setNewClient((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nnEmail">
                  Email <span className="font-normal text-muted-foreground">(optional — for reminders)</span>
                </Label>
                <Input
                  id="nnEmail"
                  value={newClient.email}
                  onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))}
                  placeholder="name@example.com"
                />
              </div>
              {clientError && <p className="text-sm text-destructive">{clientError}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Picker on the left, a compact at-a-glance context strip on the right. */}
              <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client *</Label>
                  {(() => {
                    const selectedClient = selectedClientObj;
                    // Prefer the freshly-fetched phone so an inline contact edit shows here immediately.
                    const pickerPhone = clientCtx?.phone ?? selectedClient?.phone ?? null;
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
                                  (pickerPhone ? ` · ${pickerPhone}` : "")
                                : "Search or add a client"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Search by name or phone…"
                              value={clientQuery}
                              onValueChange={setClientQuery}
                            />
                            <CommandList>
                              <CommandEmpty>No matching client.</CommandEmpty>
                              <CommandGroup>
                                {clientResults.map((client) => {
                                  const label = `${client.firstName} ${client.lastName || ""}`.trim();
                                  return (
                                    <CommandItem
                                      key={client.id}
                                      value={`${label} ${client.phone || ""}`}
                                      onSelect={() => {
                                        setValue("clientId", client.id, { shouldValidate: false });
                                        setSelectedClientObj(client);
                                        setClientError(null);
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
                              {/* Always-visible "add new" — value mirrors the query so cmdk never filters it out. */}
                              <CommandGroup>
                                <CommandItem
                                  value={clientQuery.trim() ? clientQuery.trim() : "add-new-client"}
                                  onSelect={startAddNewClient}
                                  className="text-primary"
                                >
                                  <UserPlus className="mr-2 h-4 w-4" />
                                  Add new client{clientQuery.trim() ? ` "${clientQuery.trim()}"` : ""}
                                </CommandItem>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
                </div>

                {/* Right half: at-a-glance context strip. Each element degrades gracefully —
                    no loyalty chip when the salon has loyalty off, "New client" when there's
                    no prior visit, and flags only when they apply. */}
                <div className="space-y-2">
                  <Label className="hidden select-none text-transparent sm:block" aria-hidden>
                    Details
                  </Label>
                  {(() => {
                    if (!selectedClientId) {
                      return (
                        <div className="flex h-10 items-center justify-center rounded-md border border-dashed bg-muted/30 px-3 text-xs text-muted-foreground">
                          Client details appear here
                        </div>
                      );
                    }
                    if (ctxLoading && !clientCtx) {
                      return (
                        <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                        </div>
                      );
                    }
                    if (!clientCtx) {
                      return (
                        <div className="flex h-10 items-center justify-center rounded-md border border-dashed bg-muted/30 px-3 text-xs text-muted-foreground">
                          Details unavailable
                        </div>
                      );
                    }
                    const c = clientCtx;
                    const initials =
                      `${c.firstName?.[0] ?? ""}${c.lastName?.[0] ?? ""}`.toUpperCase() || "?";
                    const tierClass =
                      c.loyalty?.tier === "GOLD"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : c.loyalty?.tier === "PLATINUM"
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                    return (
                      <div className="flex h-10 items-center gap-1.5 overflow-hidden rounded-md border bg-muted/30 px-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-purple-500 to-purple-700 text-[10px] font-bold text-white">
                          {initials}
                        </span>
                        {c.loyalty && (
                          <span
                            className={cn(
                              "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              tierClass
                            )}
                          >
                            <Star className="h-3 w-3" /> {c.loyalty.tier} · {c.loyalty.points}
                          </span>
                        )}
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {c.lastVisit
                            ? `Last ${formatInTz(new Date(c.lastVisit), "MMM d", timezone)}`
                            : "New client"}
                        </span>
                        {c.allergies && (
                          <span
                            title={`Allergy: ${c.allergies}`}
                            className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          >
                            <AlertTriangle className="h-3 w-3" /> Allergy
                          </span>
                        )}
                        {c.noShowCount > 0 && (
                          <span
                            title={`${c.noShowCount} past no-show${c.noShowCount > 1 ? "s" : ""} — consider taking a deposit`}
                            className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <Info className="h-3 w-3" /> {c.noShowCount} no-show{c.noShowCount > 1 ? "s" : ""}
                          </span>
                        )}
                        {!c.phone && (
                          <button
                            type="button"
                            onClick={openContactEditor}
                            className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 dark:bg-orange-950/40 dark:text-orange-300"
                          >
                            No phone
                          </button>
                        )}
                        <Popover
                          open={editingContact}
                          onOpenChange={(o) => {
                            if (o) setEditContact({ phone: c.phone ?? "", email: c.email ?? "" });
                            setEditingContact(o);
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto h-7 w-7 shrink-0 text-muted-foreground"
                              title="Edit contact"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-72 space-y-3">
                            <p className="text-sm font-semibold">
                              Edit contact — {c.firstName}
                            </p>
                            <div className="space-y-1.5">
                              <Label htmlFor="ctxPhone" className="text-xs">Phone</Label>
                              <Input
                                id="ctxPhone"
                                value={editContact.phone}
                                onChange={(e) => setEditContact((p) => ({ ...p, phone: e.target.value }))}
                                placeholder="Add phone"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="ctxEmail" className="text-xs">Email</Label>
                              <Input
                                id="ctxEmail"
                                value={editContact.email}
                                onChange={(e) => setEditContact((p) => ({ ...p, email: e.target.value }))}
                                placeholder="Add email"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingContact(false)}
                                disabled={savingContact}
                              >
                                Cancel
                              </Button>
                              <Button type="button" size="sm" onClick={saveContact} disabled={savingContact}>
                                {savingContact && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    );
                  })()}
                </div>
              </div>
              {clientError && <p className="text-sm text-destructive">{clientError}</p>}
            </div>
          )}

          {/* Services (1..N) — each row is a service + its own staff. Any row is removable. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{isRecurring ? "Service *" : "Services *"}</Label>
              {(() => {
                const chosen = (isRecurring ? serviceLines.slice(0, 1) : serviceLines)
                  .map((l) => services.find((s) => s.id === l.serviceId))
                  .filter((s): s is Service => Boolean(s));
                const totalPrice = chosen.reduce((sum, s) => sum + Number(s.price), 0);
                const totalDur = chosen.reduce((sum, s) => sum + s.duration, 0);
                return chosen.length > 0 ? (
                  <span className="text-sm text-muted-foreground">
                    Total: <span className="font-semibold text-foreground">${totalPrice.toFixed(2)}</span> · {totalDur} min
                  </span>
                ) : null;
              })()}
            </div>

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
              <>
                {(isRecurring ? serviceLines.slice(0, 1) : serviceLines).map((row, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="grid flex-1 gap-2 sm:grid-cols-2">
                      <SearchSelect
                        value={row.serviceId}
                        onValueChange={(v) => {
                          setServiceLines((prev) => prev.map((s, i) => (i === idx ? { ...s, serviceId: v } : s)));
                          setServicesError(null);
                        }}
                        options={serviceOptions}
                        placeholder="Select a service"
                        searchPlaceholder="Search services…"
                        emptyText="No matching service."
                      />
                      <SearchSelect
                        value={row.staffId}
                        onValueChange={(v) => {
                          setServiceLines((prev) => prev.map((s, i) => (i === idx ? { ...s, staffId: v } : s)));
                          setServicesError(null);
                        }}
                        options={staffOptions}
                        placeholder="Select staff"
                        searchPlaceholder="Search staff…"
                        emptyText="No matching staff."
                      />
                    </div>
                    {!isRecurring && serviceLines.length > 1 && (
                      <div className="flex shrink-0 items-start gap-1">
                        {/* Reorder: the first service sets the start time; the rest run after it,
                            so order decides who goes first. */}
                        <div className="flex flex-col">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={idx === 0}
                            onClick={() =>
                              setServiceLines((prev) => {
                                if (idx === 0) return prev;
                                const next = [...prev];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                return next;
                              })
                            }
                            aria-label="Move service up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={idx === serviceLines.length - 1}
                            onClick={() =>
                              setServiceLines((prev) => {
                                if (idx === prev.length - 1) return prev;
                                const next = [...prev];
                                [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                                return next;
                              })
                            }
                            aria-label="Move service down"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-0.5"
                          onClick={() => setServiceLines((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label="Remove service"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {!isRecurring ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setServiceLines((prev) => [...prev, { serviceId: "", staffId: prev[0]?.staffId || "" }])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add another service
                  </Button>
                ) : (
                  // Recurring series are single-service today (see backlog); make the collapse
                  // visible so a second service doesn't seem to silently disappear.
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Recurring series use the first service only. Turn off &quot;Make this recurring&quot; to add more.
                  </p>
                )}
              </>
            )}
            {servicesError && <p className="text-sm text-destructive">{servicesError}</p>}
          </div>
        </CardContent>
      </Card>

      {/* When — appointment mode only. Walk-ins book at the current time (see the header
          tooltip), so there's no date/slot step and no card at all. */}
      {!isWalkIn && (
      <Card>
        <CardHeader>
          <CardTitle>When</CardTitle>
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

          {primaryStaffId && primaryServiceId && selectedDate && (
            <div className="space-y-2">
              {/* Header: slot list by default; the toggle flips to a custom-minute input (e.g. 9:20). */}
              <div className="flex items-center justify-between gap-3">
                <Label>{customTimeMode ? "Custom start time" : "Available Time Slots"}</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="custom-time-toggle" className="text-sm font-normal">
                    Custom time
                  </Label>
                  <Switch
                    id="custom-time-toggle"
                    checked={customTimeMode}
                    onCheckedChange={handleCustomTimeMode}
                  />
                </div>
              </div>

              {customTimeMode ? (
                /* Custom start time — book at any minute (e.g. 9:20), not just the listed slots. */
                <div className="mt-1 space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4 duration-200 animate-in fade-in-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Clock className="h-5 w-5" />
                      </span>
                      <Input
                        type="time"
                        value={customTime}
                        onChange={(e) => applyCustomTime(e.target.value)}
                        className="h-11 w-[8.75rem] text-base font-semibold tabular-nums"
                        aria-label="Custom start time"
                        aria-invalid={customTimeCheck.status === "invalid"}
                        aria-describedby={
                          customTimeCheck.status === "invalid" ? "custom-time-error" : undefined
                        }
                        autoFocus
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground sm:border-l sm:border-primary/15 sm:pl-4">
                      Book at <span className="font-medium text-foreground">any minute</span> — e.g.
                      9:20. Perfect for back-to-back appointments.
                    </p>
                  </div>
                  {/* Live availability check (business hours, past times, provider conflicts).
                      role="status" + aria-live announces each state change to screen readers. */}
                  <div role="status" aria-live="polite">
                    {customTimeCheck.status === "checking" && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Checking availability…
                      </p>
                    )}
                    {customTimeCheck.status === "invalid" && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p
                          id="custom-time-error"
                          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {customTimeCheck.message}
                        </p>
                        {customTimeCheck.suggestionHHMM && (
                          <button
                            type="button"
                            onClick={() =>
                              applyCustomTime(
                                customTimeCheck.suggestionHHMM!,
                                customTimeCheck.suggestionDateISO
                                  ? localDayFromISO(customTimeCheck.suggestionDateISO)
                                  : undefined
                              )
                            }
                            className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                          >
                            Use {customTimeCheck.suggestionLabel}
                          </button>
                        )}
                      </div>
                    )}
                    {customTimeCheck.status === "ok" && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        This time is available.
                      </p>
                    )}
                  </div>
                </div>
              ) : isLoadingSlots ? (
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
                  No available time slots for this date. Turn on{" "}
                  <span className="font-medium text-foreground">Custom time</span> above, or select a
                  different date or staff member.
                </p>
              )}
              {(errors.startTime || slotError) && (
                <p className="text-sm text-destructive">{errors.startTime?.message || slotError}</p>
              )}
            </div>
          )}

          {(!primaryStaffId || !primaryServiceId) && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Please select a client, service, and staff member to view available time slots.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Recurring Appointment Section - appointment mode only (walk-ins can't recur) */}
      {mode === "create" && !isWalkIn && (
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
              <div className="grid items-start gap-6 lg:grid-cols-[1.85fr_1fr]">
                {/* LEFT: pattern chips, series-ends chips, advanced options */}
                <div className="space-y-6">
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
                dayOfMonth={selectedDate?.getDate()}
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
                <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr]">
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
                    {(() => {
                      const svc = services.find((s) => s.id === primaryServiceId);
                      return svc ? (
                        <p className="text-xs text-muted-foreground">
                          Current: <span className="font-medium text-foreground">${Number(svc.price).toFixed(2)}</span>
                        </p>
                      ) : null;
                    })()}
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
                    <div className="flex flex-wrap gap-2">
                      {[
                        { v: 0, label: "No buffer" },
                        { v: 5, label: "5 min" },
                        { v: 10, label: "10 min" },
                        { v: 15, label: "15 min" },
                        { v: 30, label: "30 min" },
                      ].map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setBufferMinutes(opt.v)}
                          className={cn(
                            "flex-[1_1_auto] whitespace-nowrap rounded-lg border px-2.5 py-2 text-[13px] font-semibold transition-colors",
                            bufferMinutes === opt.v
                              ? "border-primary bg-primary text-primary-foreground shadow-sm"
                              : "border-input bg-background hover:border-primary/40 hover:bg-accent"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

                </div>
                {/* END LEFT column */}

                {/* RIGHT: sticky live summary + upcoming-dates preview */}
                <div className="lg:sticky lg:top-6">
                  <div className="rounded-xl border bg-gradient-to-b from-primary/5 to-transparent p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                      <span aria-hidden>\ud83d\udccb</span> Summary
                    </h3>

                    <div className="rounded-lg border bg-background p-4 text-sm leading-relaxed">
                      <div>
                        Repeats{" "}
                        <span className="font-semibold text-primary">
                          {getPatternSummary(recurrencePattern, {
                            customWeeks,
                            specificDays,
                            dayOfWeek,
                            nthWeek,
                            dayOfMonth: selectedDate?.getDate(),
                          }).toLowerCase()}
                        </span>
                        {endType === "NEVER" && ", with no end date"}
                        {endType === "AFTER_COUNT" && (
                          <>
                            {", ending after "}
                            <span className="font-semibold">
                              {endAfterCount} appointment{endAfterCount !== 1 ? "s" : ""}
                            </span>
                          </>
                        )}
                        {endType === "BY_DATE" && endByDate && (
                          <>
                            {", ending on "}
                            <span className="font-semibold">{formatInTz(endByDate, "MMM d, yyyy", timezone)}</span>
                          </>
                        )}
                        {"."}
                      </div>
                      {!!watchedStartTime && (
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          {"at "}
                          {watchedStartTime instanceof Date
                            ? formatInTz(watchedStartTime, "h:mm a", timezone)
                            : formatInTz(new Date(watchedStartTime as string | number), "h:mm a", timezone)}
                          {" \u2022 "}
                          {getEndConditionSummary(endType, { endAfterCount, endByDate })}
                        </div>
                      )}
                    </div>

                    {typeof lockedPrice === "number" && lockedPrice > 0 && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-500">
                        <span aria-hidden>\ud83d\udd12</span> Price locked at ${lockedPrice.toFixed(2)}
                      </div>
                    )}

                    {previewDates.length > 0 && !!watchedStartTime ? (
                      <>
                        <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Upcoming dates (preview)
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger type="button">
                                <Info className="h-3.5 w-3.5" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">
                                  Appointments will be created on these dates. Click &quot;Check Availability&quot; to
                                  spot conflicts before creating.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {previewDates.map((date, index) => (
                            <div
                              key={index}
                              className="flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg border bg-background px-3 py-1.5"
                            >
                              <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                                {formatInTz(date, "MMM", timezone)}
                              </span>
                              <span className="text-sm font-semibold leading-none">
                                {formatInTz(date, "d", timezone)}
                              </span>
                            </div>
                          ))}
                          {previewDates.length >= 6 && endType !== "AFTER_COUNT" && (
                            <div className="flex min-w-[56px] items-center justify-center rounded-lg border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
                              + more
                            </div>
                          )}
                        </div>

                        {/* Check Availability Button */}
                        <Button
                          type="button"
                          onClick={handlePreviewConflicts}
                          disabled={isPreviewingConflicts || !primaryServiceId || !primaryStaffId}
                          className="mt-4 w-full"
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
                        <p className="mt-2 text-center text-[11px] text-muted-foreground">
                          We&apos;ll flag any dates that clash with existing bookings.
                        </p>
                      </>
                    ) : (
                      <p className="mt-4 text-xs text-muted-foreground">
                        Pick a date and time above to preview the series.
                      </p>
                    )}
                  </div>
                </div>
                {/* END RIGHT column */}
              </div>

              {/* Conflict results \u2014 full width below the two columns */}
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
            </CardContent>
          )}
        </Card>
      )}

      {/* Deposit — appointment mode only, and only for roles that may take payments. */}
      {mode === "create" && !isRecurring && !isWalkIn && canTakeDeposit && (
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
                      onChange={(e) => { setDepositAmount(e.target.value); if (depositError) setDepositError(null); }}
                      placeholder="0.00"
                      className="pl-7"
                      aria-invalid={depositError ? true : undefined}
                    />
                  </div>
                  {depositError && <p className="text-sm text-destructive">{depositError}</p>}
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

      {/* Additional Information (Notes) — least critical, always last. */}
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

      {/* Booking summary — a last-glance recap before committing. Appears once a client and at
          least one complete service are set; guards against mistakes, especially multi-service. */}
      {(() => {
        const selectedClient = selectedClientObj;
        const clientName = addingNewClient
          ? newClient.name.trim()
          : selectedClient
            ? `${selectedClient.firstName} ${selectedClient.lastName || ""}`.trim()
            : "";
        const lines = (isRecurring ? serviceLines.slice(0, 1) : serviceLines)
          .map((l) => ({
            service: services.find((s) => s.id === l.serviceId),
            staff: staff.find((m) => m.id === l.staffId),
          }))
          .filter((x): x is { service: Service; staff: Staff } => Boolean(x.service && x.staff));
        if (!clientName || lines.length === 0) return null;
        const total = lines.reduce((sum, x) => sum + Number(x.service.price), 0);
        const dur = lines.reduce((sum, x) => sum + x.service.duration, 0);
        const chosenMs =
          watchedStartTime instanceof Date
            ? watchedStartTime.getTime()
            : new Date(watchedStartTime as string | number).getTime();
        // Only show a "When" in the recap once the time is actually bookable — a listed slot, or a
        // custom time the server has confirmed. (customTime having characters isn't enough: it may
        // still be "checking"/"invalid", which would contradict the inline error above.)
        const summaryTimeSet = slotIsChosen(chosenMs) || customTimeReady;
        const whenText = isWalkIn
          ? "Now"
          : summaryTimeSet
            ? formatInTz(new Date(chosenMs), "EEE, MMM d · h:mm a", timezone)
            : null;
        // Deposit only exists in the appointment (non-recurring) flow; surface it + the
        // balance left for checkout so the money picture is complete.
        const depositVal = collectDeposit ? Number(depositAmount) : 0;
        const hasDeposit = !isWalkIn && !isRecurring && Number.isFinite(depositVal) && depositVal > 0;
        const balanceDue = Math.max(0, total - depositVal);
        return (
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
              {/* Left: title + the "what" */}
              <div>
                <div className="mb-3 text-sm font-semibold">Booking summary</div>
                <dl className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">Client</dt>
                  <dd className="min-w-0 font-medium">{clientName}{addingNewClient ? " (new)" : ""}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">{lines.length > 1 ? "Services" : "Service"}</dt>
                  <dd className="min-w-0 space-y-0.5">
                    {lines.map((x, i) => (
                      <div key={i} className="truncate">
                        {x.service.name}{" "}
                        <span className="text-muted-foreground">· {x.staff.firstName} {x.staff.lastName}</span>
                      </div>
                    ))}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-muted-foreground">When</dt>
                  <dd className={cn("min-w-0 font-medium", !whenText && "text-muted-foreground")}>
                    {whenText ?? "Pick a time slot"}
                  </dd>
                </div>
                </dl>
              </div>

              {/* Right: the money panel — top-aligned with the title, fills its column, groups the numbers. */}
              <div className="w-full self-start rounded-lg border bg-background p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">
                    ${total.toFixed(2)} <span className="text-muted-foreground">· {dur} min</span>
                  </span>
                </div>
                {hasDeposit && (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Deposit · {PAYMENT_METHOD_LABELS[depositMethod]}</span>
                    <span className="font-medium">−${depositVal.toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between border-t pt-2">
                  <span className="font-semibold">{hasDeposit ? "Balance at checkout" : "Due at checkout"}</span>
                  <span className="text-base font-bold text-primary">
                    ${(hasDeposit ? balanceDue : total).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Inline hint explaining why booking is blocked, so the disabled button isn't a mystery. */}
        {bookingHint && (
          <p className="mr-auto text-sm text-muted-foreground">{bookingHint}</p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        {mode === "create" && isWalkIn ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleWalkInSubmit("only")}
              disabled={isSubmitting || !canBook}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Book only
            </Button>
            <Button
              type="button"
              onClick={() => handleWalkInSubmit("checkout")}
              disabled={isSubmitting || !canBook}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
              Book &amp; check out
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={isSubmitting || !canBook}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "create"
              ? isRecurring
                ? "Create Recurring Series"
                : "Book Appointment"
              : "Update Appointment"}
          </Button>
        )}
      </div>
    </form>
  );
}
