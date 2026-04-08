"use server";

import { auth } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { SYSTEM_ROLES } from "@/lib/roles";

export interface AuthResult {
  userId: string;
  role: string;
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

  const role = salonRole ?? (isSuperAdmin ? SYSTEM_ROLES.OWNER : null);
  if (!role) return null;

  // SUPER_ADMIN bypasses permission checks; user overrides applied via userId
  if (!(await hasPermission(role, permission, isSuperAdmin, salonId, userId))) {
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

  const role = salonRole ?? (isSuperAdmin ? SYSTEM_ROLES.OWNER : null);
  if (!role) return null;

  return { userId, role, salonId, isSuperAdmin };
}
