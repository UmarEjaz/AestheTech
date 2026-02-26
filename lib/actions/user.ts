"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, canManageRole } from "@/lib/permissions";
import {
  userSchema,
  userUpdateSchema,
  passwordChangeSchema,
  UserFormData,
  UserUpdateData,
  PasswordChangeData,
  UserSearchParams,
} from "@/lib/validations/user";
import { Role, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ActionResult } from "@/lib/types";

async function checkAuth(permission: string): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission as "staff:view" | "staff:create" | "staff:update" | "staff:delete")) {
    return null;
  }

  return { userId: session.user.id, role };
}

const userListSelect = Prisma.validator<Prisma.UserSelect>()({
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
      appointments: true,
      sales: true,
    },
  },
});

export type UserListItem = Prisma.UserGetPayload<{
  select: typeof userListSelect;
}>;

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
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {
    ...(isActive !== undefined && { isActive }),
    ...(role && { role }),
    ...(query && {
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: userListSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    success: true,
    data: {
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  };
}

const userDetailSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  appointments: {
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
      appointments: true,
      sales: true,
    },
  },
});

export type UserDetail = Prisma.UserGetPayload<{
  select: typeof userDetailSelect;
}>;

export async function getUserById(id: string): Promise<ActionResult<UserDetail>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: userDetailSelect,
  });

  if (!user) {
    return { success: false, error: "User not found" };
  }

  return { success: true, data: user };
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

  const { confirmPassword, ...userData } = validationResult.data;

  // Check if the user can manage the target role
  if (!canManageRole(authResult.role, userData.role)) {
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

  // Create user
  const user = await prisma.user.create({
    data: {
      ...userData,
      password: hashedPassword,
      phone: userData.phone || null,
    },
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

  const { id, ...updateData } = validationResult.data;

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  // Check if the user can manage the target role
  if (!canManageRole(authResult.role, existingUser.role)) {
    return { success: false, error: "You cannot modify this user" };
  }

  // If changing role, check if can assign new role
  if (updateData.role && updateData.role !== existingUser.role) {
    if (!canManageRole(authResult.role, updateData.role)) {
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

  // Update user
  await prisma.user.update({
    where: { id },
    data: {
      ...updateData,
      phone: updateData.phone || null,
    },
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

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, existingUser.role)) {
    return { success: false, error: "You cannot modify this user's password" };
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
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

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, existingUser.role)) {
    return { success: false, error: "You cannot modify this user" };
  }

  // Prevent deactivating yourself
  if (id === authResult.userId) {
    return { success: false, error: "You cannot deactivate your own account" };
  }

  // Toggle active status
  const updatedUser = await prisma.user.update({
    where: { id },
    data: { isActive: !existingUser.isActive },
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
          appointments: true,
          sales: true,
        },
      },
    },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, existingUser.role)) {
    return { success: false, error: "You cannot delete this user" };
  }

  // Prevent deleting yourself
  if (id === authResult.userId) {
    return { success: false, error: "You cannot delete your own account" };
  }

  // Check for existing data - recommend deactivation instead
  if (existingUser._count.appointments > 0 || existingUser._count.sales > 0) {
    return {
      success: false,
      error: "This user has associated appointments or sales. Please deactivate the account instead of deleting.",
    };
  }

  // Delete user
  await prisma.user.delete({
    where: { id },
  });

  revalidatePath("/dashboard/staff");

  return { success: true, data: undefined };
}

// Get all active staff members (for dropdowns)
export async function getActiveStaff(): Promise<ActionResult<{ id: string; firstName: string; lastName: string; role: Role }[]>> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const staff = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
    orderBy: { firstName: "asc" },
  });

  return { success: true, data: staff };
}
