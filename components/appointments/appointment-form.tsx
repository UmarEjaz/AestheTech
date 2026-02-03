"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Loader2, Calendar as CalendarIcon, UserPlus, Users } from "lucide-react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  appointmentSchema,
  AppointmentFormData,
  AppointmentFormInput,
} from "@/lib/validations/appointment";
import {
  createAppointment,
  updateAppointment,
  getAvailableSlots,
  AppointmentListItem,
} from "@/lib/actions/appointment";
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
    }
  }, [availableSlots, initialDate, mode, appointment, setValue]);

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
        const result = await createAppointment({ ...data, clientId });
        if (result.success) {
          toast.success("Appointment booked successfully");
          router.push("/dashboard/appointments");
        } else {
          toast.error(result.error);
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
                  setValue("clientId", "walk-in-placeholder");
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
          {mode === "create" ? "Book Appointment" : "Update Appointment"}
        </Button>
      </div>
    </form>
  );
}
