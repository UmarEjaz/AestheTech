"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod/dist/zod.js";
import { format } from "date-fns";
import { Loader2, Calendar as CalendarIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";

interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
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
        });

        if (result.success) {
          setAvailableSlots(result.data);
        }
      } finally {
        setIsLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [watchedStaffId, watchedServiceId, selectedDate]);

  const onSubmit = async (data: AppointmentFormData) => {
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createAppointment(data);
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
          <div className="grid gap-4 sm:grid-cols-2">
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
                      {client.firstName} {client.lastName} - {client.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.clientId && (
                <p className="text-sm text-destructive">{errors.clientId.message}</p>
              )}
            </div>

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
          </div>

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
