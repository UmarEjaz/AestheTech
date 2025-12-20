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
  loyaltyPointsPerDollar: number;
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
          loyaltyPointsPerDollar: 1,
        },
      });

      return {
        success: true,
        data: {
          ...defaultSettings,
          taxRate: Number(defaultSettings.taxRate),
        },
      };
    }

    return {
      success: true,
      data: {
        ...settings,
        taxRate: Number(settings.taxRate),
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

    const updatedSettings = await prisma.settings.update({
      where: { id: existingSettings.id },
      data: {
        ...data,
        ...(currencySymbol && { currencySymbol }),
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");

    return {
      success: true,
      data: {
        ...updatedSettings,
        taxRate: Number(updatedSettings.taxRate),
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
