"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canManageRole } from "@/lib/permissions";
import { checkAuth } from "@/lib/auth-helpers";
import {
  userSchema,
  userUpdateSchema,
  passwordChangeSchema,
  UserFormData,
  UserUpdateData,
  PasswordChangeData,
  UserSearchParams,
} from "@/lib/validations/user";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

export type UserListItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    appointments: number;
    sales: number;
  };
};

export type UserDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  appointments: {
    id: string;
    startTime: Date;
    endTime: Date;
    status: string;
    client: {
      firstName: string;
      lastName: string | null;
      isWalkIn: boolean;
    };
    service: {
      name: string;
    };
  }[];
  schedules: {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }[];
  _count: {
    appointments: number;
    sales: number;
  };
};

export async function getUsers(params: UserSearchParams = {}): Promise<ActionResult<{
  users: UserListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { query, role, isActive, page = 1, limit = 10 } = params;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;
  const skip = (safePage - 1) * safeLimit;

  try {
    const where = {
      salonId: authResult.salonId,
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(query && {
        OR: [
          { firstName: { contains: query, mode: "insensitive" as const } },
          { lastName: { contains: query, mode: "insensitive" as const } },
          { email: { contains: query, mode: "insensitive" as const } },
          { phone: { contains: query } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              appointments: { where: { salonId: authResult.salonId } },
              sales: { where: { salonId: authResult.salonId } },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: {
        users: users as UserListItem[],
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  } catch (error) {
    console.error("Error fetching users:", error);
    return { success: false, error: "Failed to fetch users" };
  }
}

export async function getUserById(id: string): Promise<ActionResult<UserDetail>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        salonId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        appointments: {
          where: { salonId: authResult.salonId },
          orderBy: { startTime: "desc" },
          take: 10,
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            client: {
              select: { firstName: true, lastName: true, isWalkIn: true },
            },
            service: {
              select: { name: true },
            },
          },
        },
        schedules: {
          where: { salonId: authResult.salonId },
          orderBy: { dayOfWeek: "asc" },
          select: {
            id: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            isAvailable: true,
          },
        },
        _count: {
          select: {
            appointments: { where: { salonId: authResult.salonId } },
            sales: { where: { salonId: authResult.salonId } },
          },
        },
      },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (user.salonId !== authResult.salonId) {
      return { success: false, error: "User is not a member of this salon" };
    }

    if (!user.role) {
      return { success: false, error: "User has no role assigned" };
    }

    const result: UserDetail = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      appointments: user.appointments,
      schedules: user.schedules,
      _count: user._count,
    };

    return { success: true, data: result };
  } catch (error) {
    console.error("Error fetching user:", error);
    return { success: false, error: "Failed to fetch user" };
  }
}

export async function createUser(data: UserFormData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("staff:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input
  const validationResult = userSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { confirmPassword, role, ...userData } = validationResult.data;

  // Check if the user can manage the target role
  if (!canManageRole(authResult.role, role, authResult.isSuperAdmin)) {
    return { success: false, error: "You cannot create a user with this role" };
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: userData.email },
  });

  if (existingUser) {
    return { success: false, error: "A user with this email already exists" };
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(userData.password, 12);

  // Create user with salon and role, plus UserSalon junction record
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        password: hashedPassword,
        phone: userData.phone || null,
        salonId: authResult.salonId,
        role,
      },
    });

    await tx.userSalon.create({
      data: {
        userId: newUser.id,
        salonId: authResult.salonId,
        role,
      },
    });

    return newUser;
  });

  await logAudit({
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { email: userData.email, role, firstName: userData.firstName, lastName: userData.lastName },
  });

  revalidatePath("/dashboard/staff");

  return { success: true, data: { id: user.id } };
}

export async function updateUser(data: UserUpdateData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuth("staff:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input
  const validationResult = userUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, role: newRole, ...updateData } = validationResult.data;

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  if (existingUser.salonId !== authResult.salonId) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const existingRole = existingUser.role;
  if (!existingRole) {
    return { success: false, error: "User has no role assigned" };
  }

  // Check if the user can manage the target role
  if (!canManageRole(authResult.role, existingRole, authResult.isSuperAdmin)) {
    return { success: false, error: "You cannot modify this user" };
  }

  // If changing role, check if can assign new role
  if (newRole && newRole !== existingRole) {
    if (!canManageRole(authResult.role, newRole, authResult.isSuperAdmin)) {
      return { success: false, error: "You cannot assign this role" };
    }
  }

  // Check if email is being changed and if it's already taken
  if (updateData.email !== existingUser.email) {
    const emailExists = await prisma.user.findUnique({
      where: { email: updateData.email },
    });
    if (emailExists) {
      return { success: false, error: "A user with this email already exists" };
    }
  }

  // Update user and sync UserSalon role if changed
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id, salonId: authResult.salonId },
      data: {
        firstName: updateData.firstName,
        lastName: updateData.lastName,
        email: updateData.email,
        phone: updateData.phone || null,
        ...(newRole && newRole !== existingRole && { role: newRole }),
        ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
      },
    });

    // Keep UserSalon.role in sync with the denormalized User.role
    if (newRole && newRole !== existingRole) {
      await tx.userSalon.updateMany({
        where: { userId: id, salonId: authResult.salonId },
        data: { role: newRole },
      });
    }
  });

  const changes: Record<string, { from: string; to: string }> = {};
  if (updateData.email !== existingUser.email) changes.email = { from: existingUser.email, to: updateData.email };
  if (newRole && newRole !== existingRole) changes.role = { from: existingRole, to: newRole };
  if (updateData.firstName !== existingUser.firstName) changes.firstName = { from: existingUser.firstName, to: updateData.firstName };
  if (updateData.lastName !== existingUser.lastName) changes.lastName = { from: existingUser.lastName, to: updateData.lastName };

  await logAudit({
    action: "USER_UPDATED",
    entityType: "User",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: changes,
  });

  revalidatePath("/dashboard/staff");
  revalidatePath(`/dashboard/staff/${id}`);

  return { success: true, data: { id } };
}

export async function changePassword(data: PasswordChangeData): Promise<ActionResult> {
  const authResult = await checkAuth("staff:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Validate input
  const validationResult = passwordChangeSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { userId, newPassword } = validationResult.data;

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  if (existingUser.salonId !== authResult.salonId) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const targetRole = existingUser.role;
  if (!targetRole) {
    return { success: false, error: "User has no role assigned" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole, authResult.isSuperAdmin)) {
    return { success: false, error: "You cannot modify this user's password" };
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: userId, salonId: authResult.salonId },
    data: { password: hashedPassword },
  });

  await logAudit({
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: userId,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { targetUser: existingUser.email },
  });

  return { success: true, data: undefined };
}

export async function toggleUserActive(id: string): Promise<ActionResult<{ isActive: boolean }>> {
  const authResult = await checkAuth("staff:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  if (existingUser.salonId !== authResult.salonId) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const targetRole = existingUser.role;
  if (!targetRole) {
    return { success: false, error: "User has no role assigned" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole, authResult.isSuperAdmin)) {
    return { success: false, error: "You cannot modify this user" };
  }

  // Prevent deactivating yourself
  if (id === authResult.userId) {
    return { success: false, error: "You cannot deactivate your own account" };
  }

  // Toggle active status
  const updatedUser = await prisma.user.update({
    where: { id, salonId: authResult.salonId },
    data: { isActive: !existingUser.isActive },
  });

  await logAudit({
    action: updatedUser.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    entityType: "User",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { targetUser: existingUser.email, targetRole },
  });

  revalidatePath("/dashboard/staff");
  revalidatePath(`/dashboard/staff/${id}`);

  return { success: true, data: { isActive: updatedUser.isActive } };
}

export async function deleteUser(id: string): Promise<ActionResult> {
  const authResult = await checkAuth("staff:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          appointments: { where: { salonId: authResult.salonId } },
          sales: { where: { salonId: authResult.salonId } },
          recurringSeries: { where: { salonId: authResult.salonId } },
        },
      },
    },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  if (existingUser.salonId !== authResult.salonId) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const targetRole = existingUser.role;
  if (!targetRole) {
    return { success: false, error: "User has no role assigned" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole, authResult.isSuperAdmin)) {
    return { success: false, error: "You cannot delete this user" };
  }

  // Prevent deleting yourself
  if (id === authResult.userId) {
    return { success: false, error: "You cannot delete your own account" };
  }

  // Check for existing data - recommend deactivation instead
  if (existingUser._count.appointments > 0 || existingUser._count.sales > 0 || existingUser._count.recurringSeries > 0) {
    return {
      success: false,
      error: "This user has associated appointments, sales, or recurring series. Please deactivate the account instead of deleting.",
    };
  }

  // Delete the user
  await prisma.user.delete({
    where: { id, salonId: authResult.salonId },
  });

  await logAudit({
    action: "USER_DELETED",
    entityType: "User",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { email: existingUser.email, role: targetRole, firstName: existingUser.firstName, lastName: existingUser.lastName },
  });

  revalidatePath("/dashboard/staff");

  return { success: true, data: undefined };
}

// Get all active staff members (for dropdowns)
export async function getActiveStaff(): Promise<ActionResult<{ id: string; firstName: string; lastName: string; role: Role }[]>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const staff = await prisma.user.findMany({
      where: {
        salonId: authResult.salonId,
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
      },
      orderBy: { firstName: "asc" },
    });

    return { success: true, data: staff as { id: string; firstName: string; lastName: string; role: Role }[] };
  } catch (error) {
    console.error("Error fetching staff:", error);
    return { success: false, error: "Failed to fetch staff" };
  }
}
