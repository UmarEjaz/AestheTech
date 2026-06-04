"use server";

import { auth } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { SYSTEM_ROLES } from "@/lib/roles";
import type { Session } from "next-auth";

export interface AuthResult {
  userId: string;
  role: string;
  roleId: string;
  salonId: string;
  /**
   * Effective elevated access. True for a real super admin in PLATFORM ("Enter
   * salon") mode — bypasses permission checks. False when impersonating a tenant
   * user (AS_USER), so the caller behaves exactly like that user.
   */
  isSuperAdmin: boolean;
}

interface ResolvedActor {
  userId: string;
  role: string;
  roleId: string | null;
  salonId: string;
  bypass: boolean;
}

/**
 * Resolve the effective actor for the current request, accounting for an active
 * impersonation session:
 *  - PLATFORM ("Enter salon"): the super admin acts as themselves, unrestricted.
 *  - AS_USER ("Login as Owner/user"): the super admin sees exactly what that
 *    tenant user sees — no bypass, actions attributed to the borrowed identity.
 *  - No impersonation: ordinary tenant user (or legacy super admin pinned to a salon).
 * Returns null when there is no active salon or the impersonation window expired.
 */
function resolveActor(u: Session["user"]): ResolvedActor | null {
  const imp = u.impersonation;

  // Expired support session → no access (caller is bounced to /admin upstream).
  if (imp && imp.expiresAt <= Date.now()) return null;
  if (!u.salonId) return null;

  if (imp?.mode === "AS_USER") {
    if (!u.salonRole) return null; // borrowed identity must have a role at this salon
    return {
      userId: imp.actingAsUserId ?? u.id,
      role: u.salonRole,
      roleId: u.salonRoleId ?? null,
      salonId: u.salonId,
      bypass: false,
    };
  }

  // PLATFORM impersonation, or a legacy super admin still pinned to a salon.
  const bypass = u.isSuperAdmin && (!imp || imp.mode === "PLATFORM");
  const role = u.salonRole ?? (bypass ? SYSTEM_ROLES.OWNER : null);
  if (!role) return null;
  return {
    userId: u.id,
    role,
    roleId: u.salonRoleId ?? null,
    salonId: u.salonId,
    bypass,
  };
}

/**
 * Shared auth check for all server actions.
 * Verifies the user is authenticated, has an active salon, and has the required permission.
 * Returns null if any check fails.
 */
export async function checkAuth(permission: Permission): Promise<AuthResult | null> {
  const session = await auth();
  if (!session?.user) return null;

  const actor = resolveActor(session.user);
  if (!actor) return null;

  if (!(await hasPermission(actor.roleId, permission, actor.bypass, actor.salonId, actor.userId))) {
    return null;
  }

  return {
    userId: actor.userId,
    role: actor.role,
    roleId: actor.roleId ?? "",
    salonId: actor.salonId,
    isSuperAdmin: actor.bypass,
  };
}

/**
 * Lightweight auth check that only verifies the user is authenticated
 * and has an active salon (no permission check).
 */
export async function checkAuthBasic(): Promise<AuthResult | null> {
  const session = await auth();
  if (!session?.user) return null;

  const actor = resolveActor(session.user);
  if (!actor) return null;

  return {
    userId: actor.userId,
    role: actor.role,
    roleId: actor.roleId ?? "",
    salonId: actor.salonId,
    isSuperAdmin: actor.bypass,
  };
}
