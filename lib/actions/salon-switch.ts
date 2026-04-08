"use server";

import { prisma } from "@/lib/prisma";
import { checkAuthBasic } from "@/lib/auth-helpers";
import { ActionResult } from "@/lib/types";
export type UserSalonItem = {
  salonId: string;
  salonName: string;
  role: string;
  isCurrent: boolean;
};

export async function getUserSalons(): Promise<ActionResult<UserSalonItem[]>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const userSalons = await prisma.userSalon.findMany({
      where: {
        userId: authResult.userId,
        isActive: true,
        salon: { isActive: true },
      },
      include: {
        salon: {
          select: { id: true, name: true },
        },
      },
      orderBy: { salon: { name: "asc" } },
    });

    const items: UserSalonItem[] = userSalons.map((us) => ({
      salonId: us.salon.id,
      salonName: us.salon.name,
      role: us.role,
      isCurrent: us.salonId === authResult.salonId,
    }));

    return { success: true, data: items };
  } catch (error) {
    console.error("Error fetching user salons:", error);
    return { success: false, error: "Failed to fetch salons" };
  }
}

export async function switchSalon(
  targetSalonId: string
): Promise<ActionResult<{ salonId: string; role: string }>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify user has access to target salon
    const userSalon = await prisma.userSalon.findUnique({
      where: {
        userId_salonId: {
          userId: authResult.userId,
          salonId: targetSalonId,
        },
      },
      include: {
        salon: { select: { isActive: true } },
      },
    });

    if (!userSalon || !userSalon.isActive) {
      return { success: false, error: "You do not have access to this salon" };
    }

    if (!userSalon.salon.isActive) {
      return { success: false, error: "This salon is not active" };
    }

    // Update user's current salon and role
    await prisma.user.update({
      where: { id: authResult.userId },
      data: {
        salonId: targetSalonId,
        role: userSalon.role,
      },
    });

    return {
      success: true,
      data: { salonId: targetSalonId, role: userSalon.role },
    };
  } catch (error) {
    console.error("Error switching salon:", error);
    return { success: false, error: "Failed to switch salon" };
  }
}
