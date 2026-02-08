"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import { Role, Currency } from "@prisma/client";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function checkAuth(permission: Permission): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission)) {
    return null;
  }

  return { userId: session.user.id, role };
}

export interface SettingsData {
  id: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  salonLogo: string | null;
  currency: Currency;
  currencySymbol: string;
  taxRate: number;
  businessHoursStart: string;
  businessHoursEnd: string;
  appointmentInterval: number;
  allowOnlineBooking: boolean;
  loyaltyProgramEnabled: boolean;
  loyaltyPointsPerDollar: number;
  goldThreshold: number;
  platinumThreshold: number;
  silverMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
  pointsPerDollar: number;
  birthdayBonusEnabled: boolean;
  birthdayBonusPoints: number;
  pointsExpiryEnabled: boolean;
  pointsExpiryMonths: number;
}

// Get settings (cached)
export async function getSettings(): Promise<ActionResult<SettingsData>> {
  try {
    const settings = await prisma.settings.findFirst();

    if (!settings) {
      // Create default settings if none exist
      const defaultSettings = await prisma.settings.create({
        data: {
          salonName: "AestheTech Salon",
          salonAddress: null,
          salonPhone: null,
          salonEmail: null,
          salonLogo: null,
          currency: "USD",
          currencySymbol: "$",
          taxRate: 0,
          businessHoursStart: "09:00",
          businessHoursEnd: "19:00",
          appointmentInterval: 30,
          allowOnlineBooking: true,
          loyaltyProgramEnabled: true,
          loyaltyPointsPerDollar: 1,
          goldThreshold: 500,
          platinumThreshold: 1000,
          silverMultiplier: 1.0,
          goldMultiplier: 1.5,
          platinumMultiplier: 2.0,
          pointsPerDollar: 100,
          birthdayBonusEnabled: true,
          birthdayBonusPoints: 50,
          pointsExpiryEnabled: false,
          pointsExpiryMonths: 12,
        },
      });

      return {
        success: true,
        data: {
          ...defaultSettings,
          taxRate: Number(defaultSettings.taxRate),
          silverMultiplier: Number(defaultSettings.silverMultiplier),
          goldMultiplier: Number(defaultSettings.goldMultiplier),
          platinumMultiplier: Number(defaultSettings.platinumMultiplier),
        },
      };
    }

    return {
      success: true,
      data: {
        ...settings,
        taxRate: Number(settings.taxRate),
        silverMultiplier: Number(settings.silverMultiplier),
        goldMultiplier: Number(settings.goldMultiplier),
        platinumMultiplier: Number(settings.platinumMultiplier),
      },
    };
  } catch (error) {
    console.error("Error fetching settings:", error);
    return { success: false, error: "Failed to fetch settings" };
  }
}

// Update settings
export async function updateSettings(
  data: Partial<Omit<SettingsData, "id">>
): Promise<ActionResult<SettingsData>> {
  const authResult = await checkAuth("settings:manage");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existingSettings = await prisma.settings.findFirst();

    if (!existingSettings) {
      return { success: false, error: "Settings not found" };
    }

    // If currency is being changed, update the symbol
    let currencySymbol = data.currencySymbol;
    if (data.currency && !data.currencySymbol) {
      currencySymbol = data.currency === "PKR" ? "Rs." : "$";
    }

    // Validate tier thresholds if provided
    const goldThreshold = data.goldThreshold ?? existingSettings.goldThreshold;
    const platinumThreshold = data.platinumThreshold ?? existingSettings.platinumThreshold;
    if (platinumThreshold <= goldThreshold) {
      return { success: false, error: "Platinum threshold must be greater than Gold threshold" };
    }

    const pointsPerDollar = data.pointsPerDollar ?? existingSettings.pointsPerDollar;
    if (pointsPerDollar < 1) {
      return { success: false, error: "Redemption rate must be at least 1 point per currency unit" };
    }

    // Validate multipliers if provided
    const silverMult = data.silverMultiplier ?? Number(existingSettings.silverMultiplier);
    const goldMult = data.goldMultiplier ?? Number(existingSettings.goldMultiplier);
    const platMult = data.platinumMultiplier ?? Number(existingSettings.platinumMultiplier);
    if (silverMult > goldMult || goldMult > platMult) {
      return { success: false, error: "Tier multipliers must be in ascending order (Silver <= Gold <= Platinum)" };
    }

    // Validate birthday bonus points if provided
    const birthdayBonusPoints = data.birthdayBonusPoints ?? existingSettings.birthdayBonusPoints;
    if (birthdayBonusPoints < 1) {
      return { success: false, error: "Birthday bonus points must be at least 1" };
    }

    // Validate points expiry months if provided
    const pointsExpiryMonths = data.pointsExpiryMonths ?? existingSettings.pointsExpiryMonths;
    if (pointsExpiryMonths < 1) {
      return { success: false, error: "Points expiry period must be at least 1 month" };
    }

    const updatedSettings = await prisma.settings.update({
      where: { id: existingSettings.id },
      data: {
        ...data,
        ...(currencySymbol && { currencySymbol }),
      },
    });

    // Recalculate all client tiers if thresholds changed
    const thresholdsChanged =
      data.goldThreshold !== undefined || data.platinumThreshold !== undefined;
    if (thresholdsChanged) {
      await prisma.loyaltyPoints.updateMany({
        where: { balance: { gte: updatedSettings.platinumThreshold } },
        data: { tier: "PLATINUM" },
      });
      await prisma.loyaltyPoints.updateMany({
        where: {
          balance: { gte: updatedSettings.goldThreshold, lt: updatedSettings.platinumThreshold },
        },
        data: { tier: "GOLD" },
      });
      await prisma.loyaltyPoints.updateMany({
        where: { balance: { lt: updatedSettings.goldThreshold } },
        data: { tier: "SILVER" },
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");

    return {
      success: true,
      data: {
        ...updatedSettings,
        taxRate: Number(updatedSettings.taxRate),
        silverMultiplier: Number(updatedSettings.silverMultiplier),
        goldMultiplier: Number(updatedSettings.goldMultiplier),
        platinumMultiplier: Number(updatedSettings.platinumMultiplier),
      },
    };
  } catch (error) {
    console.error("Error updating settings:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

// Helper to get currency symbol (for use in components)
export async function getCurrencySymbol(): Promise<string> {
  const result = await getSettings();
  if (result.success) {
    return result.data.currencySymbol;
  }
  return "$";
}
