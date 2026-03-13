"use server";

import { auth } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { Role } from "@prisma/client";

export interface AuthResult {
  userId: string;
  role: Role;
  salonId: string;
  isSuperAdmin: boolean;
}

/**
 * Shared auth check for all server actions.
 * Verifies the user is authenticated, has a selected salon, and has the required permission.
 * Returns null if any check fails.
 */
export async function checkAuth(permission: Permission): Promise<AuthResult | null> {
  const session = await auth();
  if (!session?.user) return null;

  const { id: userId, salonId, salonRole, isSuperAdmin } = session.user;

  // Must have a salon selected (except SUPER_ADMIN platform-level actions handled separately)
  if (!salonId) return null;

  const role = salonRole as Role;
  if (!role && !isSuperAdmin) return null;

  // SUPER_ADMIN bypasses permission checks
  if (!hasPermission(role, permission, isSuperAdmin)) {
    return null;
  }

  return { userId, role, salonId, isSuperAdmin };
}

/**
 * Lightweight auth check that only verifies the user is authenticated
 * and has a salon selected (no permission check).
 */
export async function checkAuthBasic(): Promise<AuthResult | null> {
  const session = await auth();
  if (!session?.user) return null;

  const { id: userId, salonId, salonRole, isSuperAdmin } = session.user;

  if (!salonId) return null;

  const role = (salonRole as Role) ?? ("OWNER" as Role); // SUPER_ADMIN fallback

  return { userId, role, salonId, isSuperAdmin };
}
