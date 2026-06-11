"use server";

import { auth } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { isModuleEnabled } from "@/lib/actions/modules";
import { moduleKeyForPermission } from "@/lib/modules";
import { getEffectiveActor } from "@/lib/effective-actor";
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
 * Resolve the effective actor for the current request from the shared
 * `getEffectiveActor` source of truth, then apply the access guards specific to
 * server actions: deny (null) when the impersonation window has expired, there is
 * no active salon, or no role can be resolved.
 *  - PLATFORM ("Enter salon"): the super admin acts as themselves, unrestricted.
 *  - AS_USER ("Login as Owner/user"): behaves exactly as the borrowed tenant user.
 *  - No impersonation: ordinary tenant user (or legacy super admin pinned to a salon).
 */
function resolveActor(u: Session["user"]): ResolvedActor | null {
  const a = getEffectiveActor(u);

  if (a.expired) return null; // expired support session → no access
  if (!a.salonId) return null; // must have an active salon
  if (!a.role) return null; // borrowed/own identity must resolve a role at this salon
  // Non-bypass (tenant) actors must have a concrete salon role id — only a
  // bypassing super admin (PLATFORM) is allowed through without one.
  if (!a.isSuperAdmin && !a.roleId) return null;

  return {
    userId: a.userId,
    role: a.role,
    roleId: a.roleId,
    salonId: a.salonId,
    bypass: a.isSuperAdmin,
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

  // Module gating: if the permission belongs to a toggleable module that is
  // disabled for this salon, deny — UNLESS the caller has bypass (a real super
  // admin in "Enter salon"/PLATFORM mode), who sees everything for support.
  // "Login as Owner" (AS_USER) has bypass=false, so it respects module toggles.
  if (!actor.bypass) {
    const moduleKey = moduleKeyForPermission(permission);
    if (moduleKey && !(await isModuleEnabled(actor.salonId, moduleKey))) {
      return null;
    }
  }

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
