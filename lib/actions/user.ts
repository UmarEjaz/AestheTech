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
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";

async function checkAuth(permission: string): Promise<{ userId: string; role: Role; salonId: string } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.salonRole as Role;
  const salonId = session.user.salonId;
  if (!salonId) return null;

  if (!hasPermission(role, permission as "staff:view" | "staff:create" | "staff:update" | "staff:delete")) {
    return null;
  }

  return { userId: session.user.id, role, salonId };
}

/**
 * Helper to get a target user's role in a specific salon from their SalonMember record.
 * Returns null if no membership found.
 */
async function getTargetUserRole(userId: string, salonId: string): Promise<Role | null> {
  const membership = await prisma.salonMember.findUnique({
    where: { userId_salonId: { userId, salonId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

// Manually define types with `role` for backward compatibility with the UI.
// Role now comes from SalonMember, not User.
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
    // Query SalonMember to scope to current salon, with optional role filter
    const memberWhere = {
      salonId: authResult.salonId,
      ...(role && { role }),
      ...(isActive !== undefined && { user: { isActive } }),
      ...(query && {
        user: {
          ...(isActive !== undefined && { isActive }),
          OR: [
            { firstName: { contains: query, mode: "insensitive" as const } },
            { lastName: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query } },
          ],
        },
      }),
    };

    const [members, total] = await Promise.all([
      prisma.salonMember.findMany({
        where: memberWhere,
        orderBy: { user: { createdAt: "desc" } },
        skip,
        take: safeLimit,
        select: {
          role: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              _count: {
                select: {
                  appointments: true,
                  sales: true,
                },
              },
            },
          },
        },
      }),
      prisma.salonMember.count({ where: memberWhere }),
    ]);

    // Map to UserListItem shape with role from SalonMember
    const users: UserListItem[] = members.map((m) => ({
      ...m.user,
      role: m.role,
    }));

    return {
      success: true,
      data: {
        users,
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
        isActive: true,
        createdAt: true,
        updatedAt: true,
        salonMembers: {
          where: { salonId: authResult.salonId },
          select: { role: true },
          take: 1,
        },
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
      },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Get role from SalonMember for current salon
    const salonRole = user.salonMembers[0]?.role;
    if (!salonRole) {
      return { success: false, error: "User is not a member of this salon" };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { salonMembers, ...userWithoutMembers } = user;
    const result: UserDetail = {
      ...userWithoutMembers,
      role: salonRole,
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
  if (!canManageRole(authResult.role, role)) {
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

  // Create user and SalonMember atomically
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        password: hashedPassword,
        phone: userData.phone || null,
      },
    });

    await tx.salonMember.create({
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

  // Get existing user's role in this salon
  const existingRole = await getTargetUserRole(id, authResult.salonId);
  if (!existingRole) {
    return { success: false, error: "User is not a member of this salon" };
  }

  // Check if the user can manage the target role
  if (!canManageRole(authResult.role, existingRole)) {
    return { success: false, error: "You cannot modify this user" };
  }

  // If changing role, check if can assign new role
  if (newRole && newRole !== existingRole) {
    if (!canManageRole(authResult.role, newRole)) {
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

  // Update user profile and SalonMember role in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        firstName: updateData.firstName,
        lastName: updateData.lastName,
        email: updateData.email,
        phone: updateData.phone || null,
        ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
      },
    });

    // Update role on SalonMember if it changed
    if (newRole && newRole !== existingRole) {
      await tx.salonMember.update({
        where: { userId_salonId: { userId: id, salonId: authResult.salonId } },
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

  // Get target user's role in this salon
  const targetRole = await getTargetUserRole(userId, authResult.salonId);
  if (!targetRole) {
    return { success: false, error: "User is not a member of this salon" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole)) {
    return { success: false, error: "You cannot modify this user's password" };
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: userId },
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

  // Get target user's role in this salon
  const targetRole = await getTargetUserRole(id, authResult.salonId);
  if (!targetRole) {
    return { success: false, error: "User is not a member of this salon" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole)) {
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
          appointments: true,
          sales: true,
        },
      },
    },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  // Get target user's role in this salon
  const targetRole = await getTargetUserRole(id, authResult.salonId);
  if (!targetRole) {
    return { success: false, error: "User is not a member of this salon" };
  }

  // Check if the user can manage the target user
  if (!canManageRole(authResult.role, targetRole)) {
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

  // Delete the SalonMember record (removes user from this salon)
  // and delete the User record if they have no other salon memberships
  await prisma.$transaction(async (tx) => {
    await tx.salonMember.delete({
      where: { userId_salonId: { userId: id, salonId: authResult.salonId } },
    });

    // Check if user has other salon memberships
    const otherMemberships = await tx.salonMember.count({
      where: { userId: id },
    });

    // If no other memberships, delete the user entirely
    if (otherMemberships === 0) {
      await tx.user.delete({
        where: { id },
      });
    }
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
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const salonId = session.user.salonId;
  if (!salonId) {
    return { success: false, error: "No salon selected" };
  }

  try {
    const members = await prisma.salonMember.findMany({
      where: {
        salonId,
        isActive: true,
        user: { isActive: true },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { user: { firstName: "asc" } },
    });

    const staff = members.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
    }));

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching staff:", error);
    return { success: false, error: "Failed to fetch staff" };
  }
}
