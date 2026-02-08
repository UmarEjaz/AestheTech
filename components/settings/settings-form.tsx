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
import { Separator } from "@/components/ui/separator";
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
  goldThreshold: z.coerce.number().int().min(1, "Must be at least 1"),
  platinumThreshold: z.coerce.number().int().min(2, "Must be at least 2"),
  silverMultiplier: z.coerce.number().min(0.1).max(10),
  goldMultiplier: z.coerce.number().min(0.1).max(10),
  platinumMultiplier: z.coerce.number().min(0.1).max(10),
  pointsPerDollar: z.coerce.number().int().min(1, "Must be at least 1"),
}).refine((data) => data.platinumThreshold > data.goldThreshold, {
  message: "Platinum threshold must be greater than Gold threshold",
  path: ["platinumThreshold"],
}).refine((data) => data.silverMultiplier <= data.goldMultiplier && data.goldMultiplier <= data.platinumMultiplier, {
  message: "Multipliers must be in ascending order (Silver <= Gold <= Platinum)",
  path: ["platinumMultiplier"],
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
  goldThreshold: number;
  platinumThreshold: number;
  silverMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
  pointsPerDollar: number;
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
      goldThreshold: settings.goldThreshold,
      platinumThreshold: settings.platinumThreshold,
      silverMultiplier: settings.silverMultiplier,
      goldMultiplier: settings.goldMultiplier,
      platinumMultiplier: settings.platinumMultiplier,
      pointsPerDollar: settings.pointsPerDollar,
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
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
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
            Configure loyalty points, tier thresholds, benefits, and redemption settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Points Earning */}
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
              Base loyalty points earned for each {watchedCurrency === "PKR" ? "100 Rs." : "$1"} spent
            </p>
          </div>

          <Separator />

          {/* Tier Thresholds */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Tier Thresholds</Label>
            <p className="text-sm text-muted-foreground">
              Points required to reach each loyalty tier
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Silver</Label>
                <Input value="0" disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">Always starts at 0</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goldThreshold">Gold</Label>
                <Input
                  id="goldThreshold"
                  type="number"
                  min="1"
                  {...register("goldThreshold")}
                  disabled={!canManage}
                />
                {errors.goldThreshold && (
                  <p className="text-sm text-destructive">{errors.goldThreshold.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="platinumThreshold">Platinum</Label>
                <Input
                  id="platinumThreshold"
                  type="number"
                  min="2"
                  {...register("platinumThreshold")}
                  disabled={!canManage}
                />
                {errors.platinumThreshold && (
                  <p className="text-sm text-destructive">{errors.platinumThreshold.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Tier Benefits (Multipliers) */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Tier Benefits (Point Multipliers)</Label>
            <p className="text-sm text-muted-foreground">
              Higher-tier members earn bonus points on every purchase. For example, with a 1.5x multiplier, a Gold member earning 100 base points will receive 150 points total.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="silverMultiplier">Silver Multiplier</Label>
                <Input
                  id="silverMultiplier"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  {...register("silverMultiplier")}
                  disabled={!canManage}
                />
                {errors.silverMultiplier && (
                  <p className="text-sm text-destructive">{errors.silverMultiplier.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="goldMultiplier">Gold Multiplier</Label>
                <Input
                  id="goldMultiplier"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  {...register("goldMultiplier")}
                  disabled={!canManage}
                />
                {errors.goldMultiplier && (
                  <p className="text-sm text-destructive">{errors.goldMultiplier.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="platinumMultiplier">Platinum Multiplier</Label>
                <Input
                  id="platinumMultiplier"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  {...register("platinumMultiplier")}
                  disabled={!canManage}
                />
                {errors.platinumMultiplier && (
                  <p className="text-sm text-destructive">{errors.platinumMultiplier.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Redemption Rate */}
          <div className="space-y-2">
            <Label htmlFor="pointsPerDollar">Redemption Rate (points per {watchedCurrency === "PKR" ? "Rs.1" : "$1"})</Label>
            <Input
              id="pointsPerDollar"
              type="number"
              min="1"
              {...register("pointsPerDollar")}
              disabled={!canManage}
              className="w-full sm:w-[200px]"
            />
            {errors.pointsPerDollar && (
              <p className="text-sm text-destructive">{errors.pointsPerDollar.message}</p>
            )}
            <p className="text-sm text-muted-foreground">
              How many points equal {watchedCurrency === "PKR" ? "Rs.1" : "$1"} when redeeming at checkout
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
