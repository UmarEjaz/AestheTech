"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canManageRole, hasPermission } from "@/lib/permissions";
import { checkAuth, checkAuthBasic } from "@/lib/auth-helpers";
import { SYSTEM_ROLES } from "@/lib/roles";
import {
  userSchema,
  userUpdateSchema,
  passwordChangeSchema,
  UserFormData,
  UserUpdateData,
  PasswordChangeData,
  UserSearchParams,
} from "@/lib/validations/user";
import bcrypt from "bcryptjs";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { isModuleEnabled } from "./modules";

export type UserListItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string;        // Slug (e.g., "owner") — for matching/logic
  roleName: string;    // Display name (e.g., "Owner") — for UI
  roleColor: string;   // Hex color (e.g., "#9333EA") — for badge styling
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
  role: string;
  roleLabel: string;
  roleColor: string;
  roleDefinitionId: string | null;
  isActive: boolean;
  isServiceProvider: boolean;
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
    services: {
      service: { name: string };
    }[];
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
    // Resolve staff via branch membership (UserSalon). `User.salonId` is volatile (it's
    // the user's last-used branch), so it can't be used to determine who works here.
    // Pulling the role from UserSalon also gives this user's role AT THIS BRANCH.
    const where = {
      salonId: authResult.salonId,
      isActive: true,
      ...(role && { roleDefinitionId: role }),
      user: {
        // Platform-level super admins are never tenant staff — never list them.
        isSuperAdmin: false,
        ...(isActive !== undefined && { isActive }),
        ...(query && {
          OR: [
            { firstName: { contains: query, mode: "insensitive" as const } },
            { lastName: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query } },
          ],
        }),
      },
    };

    const [userSalons, total] = await Promise.all([
      prisma.userSalon.findMany({
        where,
        orderBy: { user: { createdAt: "desc" } },
        skip,
        take: safeLimit,
        select: {
          roleDefinitionId: true,
          roleDefinition: { select: { slug: true, name: true, color: true } },
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
                  // Appointment involvement is via per-service assignments now.
                  appointmentServices: { where: { salonId: authResult.salonId } },
                  sales: { where: { salonId: authResult.salonId } },
                },
              },
            },
          },
        },
      }),
      prisma.userSalon.count({ where }),
    ]);

    const mappedUsers: UserListItem[] = userSalons.map((us) => ({
      id: us.user.id,
      firstName: us.user.firstName,
      lastName: us.user.lastName,
      email: us.user.email,
      phone: us.user.phone,
      role: us.roleDefinition?.slug ?? "",
      roleName: us.roleDefinition?.name ?? "",
      roleColor: us.roleDefinition?.color ?? "#6B7280",
      isActive: us.user.isActive,
      createdAt: us.user.createdAt,
      updatedAt: us.user.updatedAt,
      _count: { appointments: us.user._count.appointmentServices, sales: us.user._count.sales },
    }));

    return {
      success: true,
      data: {
        users: mappedUsers,
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
        roleDefinitionId: true,
        roleDefinition: { select: { name: true, slug: true, color: true } },
        salonId: true,
        isSuperAdmin: true,
        isActive: true,
        isServiceProvider: true,
        createdAt: true,
        updatedAt: true,
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
            sales: { where: { salonId: authResult.salonId } },
          },
        },
      },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Verify membership via UserSalon, not the volatile User.salonId (which only
    // tracks the user's last-active salon — a branch member's may point elsewhere).
    // The membership also carries the user's role AT THIS SALON (role definitions
    // are per-salon), which is what we display/edit — not the denormalized
    // User.roleDefinitionId. Super admins are never editable as tenant staff.
    const membership = await prisma.userSalon.findFirst({
      where: { userId: id, salonId: authResult.salonId, isActive: true },
      select: {
        roleDefinitionId: true,
        roleDefinition: { select: { slug: true, name: true, color: true } },
      },
    });
    if (user.isSuperAdmin || !membership) {
      return { success: false, error: "User is not a member of this salon" };
    }

    if (!membership.roleDefinitionId) {
      return { success: false, error: "User has no role assigned" };
    }

    // Staff history spans EVERY service this user performs, not only appointments where they
    // are the primary provider — query through the per-service relation so secondary services
    // still count toward their recent list and total.
    const staffAppointmentWhere = {
      salonId: authResult.salonId,
      services: { some: { staffId: id } },
    };
    const [recentAppointments, appointmentCount] = await Promise.all([
      prisma.appointment.findMany({
        where: staffAppointmentWhere,
        orderBy: { startTime: "desc" },
        take: 10,
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          client: { select: { firstName: true, lastName: true, isWalkIn: true } },
          services: {
            orderBy: { order: "asc" },
            select: { service: { select: { name: true } } },
          },
        },
      }),
      prisma.appointment.count({ where: staffAppointmentWhere }),
    ]);

    const result: UserDetail = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: membership.roleDefinition?.slug ?? "",
      roleLabel: membership.roleDefinition?.name ?? "",
      roleColor: membership.roleDefinition?.color ?? "#6B7280",
      roleDefinitionId: membership.roleDefinitionId,
      isActive: user.isActive,
      isServiceProvider: user.isServiceProvider,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      appointments: recentAppointments,
      schedules: user.schedules,
      _count: { appointments: appointmentCount, sales: user._count.sales },
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
  const { confirmPassword, role: roleDefinitionId, ...userData } = validationResult.data;

  // Check if the user can manage the target role
  if (!(await canManageRole(authResult.roleId, roleDefinitionId, authResult.isSuperAdmin, authResult.salonId))) {
    return { success: false, error: "You cannot create a user with this role" };
  }

  // Resolve the organization seat limit up front. Enforcement happens INSIDE the
  // create transaction (guarded by a per-org advisory lock) so two concurrent
  // creates can't both pass the check and exceed the cap. Effective super admins
  // (Enter salon / platform) bypass the cap entirely.
  let seatLimit: number | null = null;
  let orgSalonIds: string[] = [];
  let orgRootId = authResult.salonId;
  if (!authResult.isSuperAdmin) {
    const { getOrgRootSalonId, getOrganizationSalonIds } = await import("./branch");
    orgRootId = await getOrgRootSalonId(authResult.salonId);
    const [ids, root] = await Promise.all([
      getOrganizationSalonIds(authResult.salonId),
      prisma.salon.findUnique({ where: { id: orgRootId }, select: { maxStaff: true } }),
    ]);
    orgSalonIds = ids;
    seatLimit = root?.maxStaff ?? null;
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

  // Create user with salon and role, plus UserSalon junction record. The seat-cap
  // check runs inside the same transaction behind a per-org advisory lock so it
  // is atomic with the insert (no two concurrent creates can both pass).
  const SEAT_LIMIT_REACHED = "SEAT_LIMIT_REACHED";
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      if (seatLimit !== null) {
        // Serialize concurrent staff creates for this organization. The lock is
        // held until the transaction commits/rolls back.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgRootId}))`;
        const members = await tx.userSalon.findMany({
          where: {
            salonId: { in: orgSalonIds },
            isActive: true,
            user: { isActive: true, isSuperAdmin: false },
          },
          select: { userId: true },
          distinct: ["userId"],
        });
        if (members.length >= seatLimit) {
          throw new Error(SEAT_LIMIT_REACHED);
        }
      }

      const newUser = await tx.user.create({
        data: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          password: hashedPassword,
          phone: userData.phone || null,
          isServiceProvider: data.isServiceProvider ?? false,
          salonId: authResult.salonId,
          roleDefinitionId,
        },
      });

      await tx.userSalon.create({
        data: {
          userId: newUser.id,
          salonId: authResult.salonId,
          roleDefinitionId,
        },
      });

      return newUser;
    });
  } catch (error) {
    if (error instanceof Error && error.message === SEAT_LIMIT_REACHED) {
      return {
        success: false,
        error: `This salon has reached its staff limit (${seatLimit}). Increase the limit in admin to add more staff.`,
      };
    }
    throw error;
  }

  await logAudit({
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { email: userData.email, roleDefinitionId, firstName: userData.firstName, lastName: userData.lastName },
  });

  revalidatePath("/dashboard/staff");

  return { success: true, data: { id: user.id } };
}

export async function updateUser(data: UserUpdateData): Promise<ActionResult<{ id: string }>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }
  if (!authResult.isSuperAdmin && !(await isModuleEnabled(authResult.salonId, "staff"))) {
    return { success: false, error: "Staff is not enabled for this salon." };
  }

  // Validate input
  const validationResult = userUpdateSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { id, role: newRoleDefId, ...updateData } = validationResult.data;

  const isSelfEdit = id === authResult.userId;

  // Self-edit: anyone can update their own profile (name, phone, email)
  // Editing others: requires staff:update permission + hierarchy check
  if (!isSelfEdit) {
    const hasUpdatePerm = await hasPermission(authResult.roleId || null, "staff:update", authResult.isSuperAdmin, authResult.salonId, authResult.userId);
    if (!hasUpdatePerm) {
      return { success: false, error: "Unauthorized" };
    }
  }

  // Get current user data
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  // Verify membership via UserSalon, not the volatile User.salonId (a branch
  // member's may point at a different salon). The membership also carries the
  // user's role AT THIS SALON — role definitions are per-salon, so we must use
  // this (not the denormalized User.roleDefinitionId, which reflects the user's
  // last-active salon) for the hierarchy check.
  const membership = await prisma.userSalon.findFirst({
    where: { userId: id, salonId: authResult.salonId, isActive: true },
    select: { roleDefinitionId: true, roleDefinition: { select: { slug: true } } },
  });
  if (!membership) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const existingRoleDefId = membership.roleDefinitionId;
  if (!existingRoleDefId) {
    return { success: false, error: "User has no role assigned" };
  }
  const targetIsOwner = membership.roleDefinition?.slug === SYSTEM_ROLES.OWNER;

  if (isSelfEdit) {
    // Self-edit: you can't change your own role. Roles are now compared by id on
    // both sides (the form submits your unchanged role id), so this only triggers
    // on a genuine tamper attempt — normal self-edits (e.g. toggling Service
    // Provider) pass cleanly.
    if (newRoleDefId && newRoleDefId !== existingRoleDefId) {
      return { success: false, error: "You can't change your own role — ask your owner or an admin to change it for you." };
    }

    // Self-edit: only Owner can toggle isServiceProvider for themselves
    if (updateData.isServiceProvider !== undefined && updateData.isServiceProvider !== existingUser.isServiceProvider) {
      if (authResult.role !== SYSTEM_ROLES.OWNER && !authResult.isSuperAdmin) {
        return { success: false, error: "You can't change your own service provider status. Ask the salon owner to update it for you." };
      }
    }
  } else {
    // Editing others: check hierarchy
    if (!(await canManageRole(authResult.roleId, existingRoleDefId, authResult.isSuperAdmin, authResult.salonId))) {
      return {
        success: false,
        error: targetIsOwner
          ? "The owner's profile can only be edited by the owner."
          : "You can only edit staff members whose role is below your own.",
      };
    }

    // If changing role, check if can assign new role
    if (newRoleDefId && newRoleDefId !== existingRoleDefId) {
      if (!(await canManageRole(authResult.roleId, newRoleDefId, authResult.isSuperAdmin, authResult.salonId))) {
        return { success: false, error: "You can only assign roles below your own." };
      }
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

  // Update user and sync UserSalon roleDefinitionId if changed
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id, salonId: authResult.salonId },
      data: {
        firstName: updateData.firstName,
        lastName: updateData.lastName,
        email: updateData.email,
        phone: updateData.phone || null,
        ...(!isSelfEdit && newRoleDefId && newRoleDefId !== existingRoleDefId && { roleDefinitionId: newRoleDefId }),
        ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
        ...(updateData.isServiceProvider !== undefined && { isServiceProvider: updateData.isServiceProvider }),
      },
    });

    // Keep UserSalon.roleDefinitionId in sync with the denormalized User.roleDefinitionId
    if (!isSelfEdit && newRoleDefId && newRoleDefId !== existingRoleDefId) {
      await tx.userSalon.upsert({
        where: { userId_salonId: { userId: id, salonId: authResult.salonId } },
        update: { roleDefinitionId: newRoleDefId },
        create: { userId: id, salonId: authResult.salonId, roleDefinitionId: newRoleDefId },
      });
    }
  });

  const changes: Record<string, { from: string; to: string }> = {};
  if (updateData.email !== existingUser.email) changes.email = { from: existingUser.email, to: updateData.email };
  if (newRoleDefId && newRoleDefId !== existingRoleDefId) changes.roleDefinitionId = { from: existingRoleDefId, to: newRoleDefId };
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

  const targetRoleDefId = existingUser.roleDefinitionId;
  if (!targetRoleDefId) {
    return { success: false, error: "User has no role assigned" };
  }

  // Check if the user can manage the target user
  if (!(await canManageRole(authResult.roleId, targetRoleDefId, authResult.isSuperAdmin, authResult.salonId))) {
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

  // Membership + role come from UserSalon at the current salon (roles are
  // per-salon; User.salonId is the volatile last-active stamp).
  const membership = await prisma.userSalon.findFirst({
    where: { userId: id, salonId: authResult.salonId, isActive: true },
    select: { roleDefinitionId: true },
  });
  if (!membership) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const targetRoleDefId = membership.roleDefinitionId;
  if (!targetRoleDefId) {
    return { success: false, error: "User has no role assigned" };
  }

  // Prevent deactivating yourself — checked before the hierarchy check so the
  // user gets the accurate message (not the generic "role below your own").
  if (id === authResult.userId) {
    return { success: false, error: "You cannot deactivate your own account" };
  }

  // Check if the user can manage the target user
  if (!(await canManageRole(authResult.roleId, targetRoleDefId, authResult.isSuperAdmin, authResult.salonId))) {
    return { success: false, error: "You can only deactivate staff members whose role is below your own." };
  }

  // Toggle active status (User.isActive is global, not per-salon)
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
    details: { targetUser: existingUser.email, targetRoleDefId },
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
          // Involvement in appointments is now via per-service assignments (no appointment.staffId).
          appointmentServices: { where: { salonId: authResult.salonId } },
          sales: { where: { salonId: authResult.salonId } },
          recurringSeries: { where: { salonId: authResult.salonId } },
        },
      },
    },
  });

  if (!existingUser) {
    return { success: false, error: "User not found" };
  }

  // Membership + role come from UserSalon at the current salon (roles are
  // per-salon; User.salonId is the volatile last-active stamp).
  const membership = await prisma.userSalon.findFirst({
    where: { userId: id, salonId: authResult.salonId, isActive: true },
    select: { roleDefinitionId: true },
  });
  if (!membership) {
    return { success: false, error: "User is not a member of this salon" };
  }

  const targetRoleDefId = membership.roleDefinitionId;
  if (!targetRoleDefId) {
    return { success: false, error: "User has no role assigned" };
  }

  // Prevent deleting yourself — checked before the hierarchy check so the user
  // gets the accurate message (not the generic "role below your own").
  if (id === authResult.userId) {
    return { success: false, error: "You cannot delete your own account" };
  }

  // Check if the user can manage the target user
  if (!(await canManageRole(authResult.roleId, targetRoleDefId, authResult.isSuperAdmin, authResult.salonId))) {
    return { success: false, error: "You can only delete staff members whose role is below your own." };
  }

  // Check for existing data - recommend deactivation instead
  if (existingUser._count.appointmentServices > 0 || existingUser._count.sales > 0 || existingUser._count.recurringSeries > 0) {
    return {
      success: false,
      error: "This user has associated appointments, sales, or recurring series. Please deactivate the account instead of deleting.",
    };
  }

  // Delete the user (global; membership + hierarchy verified above)
  await prisma.user.delete({
    where: { id },
  });

  await logAudit({
    action: "USER_DELETED",
    entityType: "User",
    entityId: id,
    userId: authResult.userId,
    userRole: authResult.role,
    details: { email: existingUser.email, roleDefinitionId: targetRoleDefId, firstName: existingUser.firstName, lastName: existingUser.lastName },
  });

  revalidatePath("/dashboard/staff");

  return { success: true, data: undefined };
}

// Get all active staff members (for dropdowns)
export async function getActiveStaff(branchFilter: "current" | "all" = "current"): Promise<ActionResult<{ id: string; firstName: string; lastName: string; role: string }[]>> {
  const authResult = await checkAuth("staff:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    let salonFilter: string | { in: string[] } = authResult.salonId;
    const canViewAllBranches = await hasPermission(authResult.roleId, "data:all-branches", authResult.isSuperAdmin, authResult.salonId, authResult.userId);
    if (branchFilter === "all" && canViewAllBranches) {
      const { getOrganizationSalonIds } = await import("./branch");
      const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);
      salonFilter = { in: orgSalonIds };
    }

    const memberships = await prisma.userSalon.findMany({
      where: {
        salonId: salonFilter,
        isActive: true,
        user: { isActive: true },
      },
      select: {
        roleDefinitionId: true,
        roleDefinition: { select: { name: true } },
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

    const staff = Array.from(
      new Map(
        memberships.map((m) => [
          m.user.id,
          {
            id: m.user.id,
            firstName: m.user.firstName,
            lastName: m.user.lastName,
            role: m.roleDefinition.name,
          },
        ])
      ).values()
    );

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching staff:", error);
    return { success: false, error: "Failed to fetch staff" };
  }
}
