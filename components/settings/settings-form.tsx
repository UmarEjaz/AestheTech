"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Building2, Clock, DollarSign, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsData, updateSettings } from "@/lib/actions/settings";
import { Currency } from "@prisma/client";

const settingsSchema = z.object({
  salonName: z.string().min(1, "Salon name is required").max(100),
  salonAddress: z.string().max(200).optional().nullable(),
  salonPhone: z.string().max(20).optional().nullable(),
  salonEmail: z.string().email().optional().or(z.literal("")).nullable(),
  currency: z.nativeEnum(Currency),
  taxRate: z.coerce.number().min(0).max(100),
  businessHoursStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
  businessHoursEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
  appointmentInterval: z.coerce.number().min(15).max(120),
  loyaltyPointsPerDollar: z.coerce.number().min(0).max(100),
});

type SettingsFormData = {
  salonName: string;
  salonAddress?: string | null;
  salonPhone?: string | null;
  salonEmail?: string | null;
  currency: Currency;
  taxRate: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  appointmentInterval: number;
  loyaltyPointsPerDollar: number;
};

interface SettingsFormProps {
  settings: SettingsData;
  canManage: boolean;
}

// Generate time options in 30-minute intervals
function generateTimeOptions() {
  const options = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const h = hour.toString().padStart(2, "0");
      const m = minute.toString().padStart(2, "0");
      const time = `${h}:${m}`;
      const display = new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      options.push({ value: time, label: display });
    }
  }
  return options;
}

const timeOptions = generateTimeOptions();

export function SettingsForm({ settings, canManage }: SettingsFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema) as any,
    defaultValues: {
      salonName: settings.salonName,
      salonAddress: settings.salonAddress || "",
      salonPhone: settings.salonPhone || "",
      salonEmail: settings.salonEmail || "",
      currency: settings.currency,
      taxRate: settings.taxRate,
      businessHoursStart: settings.businessHoursStart,
      businessHoursEnd: settings.businessHoursEnd,
      appointmentInterval: settings.appointmentInterval,
      loyaltyPointsPerDollar: settings.loyaltyPointsPerDollar,
    },
  });

  const watchedCurrency = watch("currency");
  const watchedBusinessHoursStart = watch("businessHoursStart");
  const watchedBusinessHoursEnd = watch("businessHoursEnd");

  const onSubmit = async (data: SettingsFormData) => {
    if (!canManage) {
      toast.error("You don't have permission to update settings");
      return;
    }

    setIsSubmitting(true);

    try {
      // Validate business hours
      if (data.businessHoursStart >= data.businessHoursEnd) {
        toast.error("Business hours end time must be after start time");
        setIsSubmitting(false);
        return;
      }

      const result = await updateSettings({
        ...data,
        salonAddress: data.salonAddress || null,
        salonPhone: data.salonPhone || null,
        salonEmail: data.salonEmail || null,
      });

      if (result.success) {
        toast.success("Settings updated successfully");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Salon Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Salon Information
          </CardTitle>
          <CardDescription>
            Basic information about your salon
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="salonName">Salon Name *</Label>
              <Input
                id="salonName"
                {...register("salonName")}
                disabled={!canManage}
              />
              {errors.salonName && (
                <p className="text-sm text-destructive">{errors.salonName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="salonPhone">Phone</Label>
              <Input
                id="salonPhone"
                {...register("salonPhone")}
                placeholder="+1 (555) 123-4567"
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="salonEmail">Email</Label>
            <Input
              id="salonEmail"
              type="email"
              {...register("salonEmail")}
              placeholder="contact@salon.com"
              disabled={!canManage}
            />
            {errors.salonEmail && (
              <p className="text-sm text-destructive">{errors.salonEmail.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="salonAddress">Address</Label>
            <Input
              id="salonAddress"
              {...register("salonAddress")}
              placeholder="123 Main St, City, State 12345"
              disabled={!canManage}
            />
          </div>
        </CardContent>
      </Card>

      {/* Business Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Business Hours
          </CardTitle>
          <CardDescription>
            Set your salon's operating hours. These hours are used for appointment scheduling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="businessHoursStart">Opening Time *</Label>
              <Select
                value={watchedBusinessHoursStart}
                onValueChange={(value) => setValue("businessHoursStart", value, { shouldDirty: true })}
                disabled={!canManage}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select opening time" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.businessHoursStart && (
                <p className="text-sm text-destructive">{errors.businessHoursStart.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessHoursEnd">Closing Time *</Label>
              <Select
                value={watchedBusinessHoursEnd}
                onValueChange={(value) => setValue("businessHoursEnd", value, { shouldDirty: true })}
                disabled={!canManage}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select closing time" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.businessHoursEnd && (
                <p className="text-sm text-destructive">{errors.businessHoursEnd.message}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointmentInterval">Appointment Interval (minutes)</Label>
            <Select
              value={watch("appointmentInterval").toString()}
              onValueChange={(value) => setValue("appointmentInterval", parseInt(value), { shouldDirty: true })}
              disabled={!canManage}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Time slots in the booking calendar will be displayed in this interval
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Currency & Tax */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Currency & Tax
          </CardTitle>
          <CardDescription>
            Configure currency and tax settings for invoices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={watchedCurrency}
                onValueChange={(value) => setValue("currency", value as Currency, { shouldDirty: true })}
                disabled={!canManage}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="PKR">PKR (Rs.)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxRate">Tax Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                {...register("taxRate")}
                disabled={!canManage}
              />
              {errors.taxRate && (
                <p className="text-sm text-destructive">{errors.taxRate.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loyalty Program */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" />
            Loyalty Program
          </CardTitle>
          <CardDescription>
            Configure loyalty points settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="loyaltyPointsPerDollar">Points per {watchedCurrency === "PKR" ? "100 Rs." : "$1"}</Label>
            <Input
              id="loyaltyPointsPerDollar"
              type="number"
              min="0"
              max="100"
              {...register("loyaltyPointsPerDollar")}
              disabled={!canManage}
              className="w-full sm:w-[200px]"
            />
            {errors.loyaltyPointsPerDollar && (
              <p className="text-sm text-destructive">{errors.loyaltyPointsPerDollar.message}</p>
            )}
            <p className="text-sm text-muted-foreground">
              Number of loyalty points earned for each {watchedCurrency === "PKR" ? "100 Rs." : "$1"} spent
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      {canManage && (
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      )}

      {!canManage && (
        <p className="text-sm text-muted-foreground text-center">
          You don't have permission to edit settings. Contact your administrator to make changes.
        </p>
      )}
    </form>
  );
}
