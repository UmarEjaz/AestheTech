import { z } from "zod";
import { BOOKING_MODES, type BookingMode } from "@/lib/constants/booking-modes";
import { RECEIPT_SIZES, type ReceiptSize } from "@/lib/constants/receipt-sizes";
import { CURRENCIES } from "@/lib/currencies";

const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

/** Validation for the salon Settings form (the server action re-validates on its own). */
export const settingsSchema = z.object({
  salonName: z.string().min(1, "Salon name is required").max(100),
  salonAddress: z.string().max(200).optional().nullable(),
  salonPhone: z.string().max(20).optional().nullable(),
  salonEmail: z.string().email().optional().or(z.literal("")).nullable(),
  timezone: z.string().min(1, "Timezone is required"),
  currencyCode: z.string().refine((code) => CURRENCY_CODES.has(code), { message: "Unsupported currency code" }),
  taxRate: z.coerce.number().min(0).max(100),
  taxNumber: z.string().max(50, "Tax number must be 50 characters or fewer").optional().nullable(),
  receiptFooter: z.string().max(300, "Footer note must be 300 characters or fewer").optional().nullable(),
  businessHoursStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
  businessHoursEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format"),
  appointmentInterval: z.coerce.number().min(15).max(120),
  defaultBookingMode: z.enum(BOOKING_MODES),
  receiptSize: z.enum(RECEIPT_SIZES),
  loyaltyProgramEnabled: z.boolean(),
  loyaltyPointsPerDollar: z.coerce.number().min(0).max(100),
  goldThreshold: z.coerce.number().int().min(1, "Must be at least 1"),
  platinumThreshold: z.coerce.number().int().min(2, "Must be at least 2"),
  memberMultiplier: z.coerce.number().min(0.1).max(10),
  goldMultiplier: z.coerce.number().min(0.1).max(10),
  platinumMultiplier: z.coerce.number().min(0.1).max(10),
  pointsPerDollar: z.coerce.number().int().min(1, "Must be at least 1"),
  birthdayBonusEnabled: z.boolean(),
  birthdayBonusPoints: z.coerce.number().int().min(1, "Must be at least 1"),
  pointsExpiryEnabled: z.boolean(),
  pointsExpiryMonths: z.coerce.number().int().min(1, "Must be at least 1 month").max(120, "Maximum 120 months"),
  allowPartialPayment: z.boolean(),
  allowPayLater: z.boolean(),
}).refine((data) => data.platinumThreshold > data.goldThreshold, {
  message: "Platinum threshold must be greater than Gold threshold",
  path: ["platinumThreshold"],
}).refine((data) => data.memberMultiplier <= data.goldMultiplier && data.goldMultiplier <= data.platinumMultiplier, {
  message: "Multipliers must be in ascending order (Member <= Gold <= Platinum)",
  path: ["platinumMultiplier"],
});

/** The form's field values (numbers are already coerced; see the schema). */
export type SettingsFormData = {
  salonName: string;
  salonAddress?: string | null;
  salonPhone?: string | null;
  salonEmail?: string | null;
  timezone: string;
  currencyCode: string;
  taxRate: number;
  taxNumber?: string | null;
  receiptFooter?: string | null;
  businessHoursStart: string;
  businessHoursEnd: string;
  appointmentInterval: number;
  defaultBookingMode: BookingMode;
  receiptSize: ReceiptSize;
  loyaltyProgramEnabled: boolean;
  loyaltyPointsPerDollar: number;
  goldThreshold: number;
  platinumThreshold: number;
  memberMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
  pointsPerDollar: number;
  birthdayBonusEnabled: boolean;
  birthdayBonusPoints: number;
  pointsExpiryEnabled: boolean;
  pointsExpiryMonths: number;
  allowPartialPayment: boolean;
  allowPayLater: boolean;
};
