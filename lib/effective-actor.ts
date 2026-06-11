import type { Session } from "next-auth";
import { SYSTEM_ROLES } from "@/lib/roles";

/**
 * The effective actor for the current request — the SINGLE source of truth for
 * "who am I acting as right now?" used by BOTH dashboard pages and server
 * actions (via resolveActor in auth-helpers).
 *
 * During "Login as Owner" (AS_USER impersonation) every field reflects the
 * borrowed user — role, the (lack of) super-admin bypass, and the user id whose
 * individual permission overrides apply — so the whole app treats the super admin
 * exactly like that tenant user. In "Enter salon" (PLATFORM) mode the super admin
 * keeps full bypass. Outside impersonation it's just the logged-in user.
 */
export interface EffectiveActor {
  /** User id whose per-user permission overrides apply (borrowed user in AS_USER). */
  userId: string;
  /** Role definition id at the active salon (borrowed role in AS_USER). */
  roleId: string | null;
  /** Role slug, with an OWNER fallback when a bypassing super admin has no role. */
  role: string | null;
  /** Active salon id. */
  salonId: string | null;
  /** EFFECTIVE elevated access (bypass). False while acting as a tenant user (AS_USER). */
  isSuperAdmin: boolean;
  /** True when the impersonation window has expired (callers should deny access). */
  expired: boolean;
}

export function getEffectiveActor(user: Session["user"]): EffectiveActor {
  const imp = user.impersonation;
  const expired = imp ? imp.expiresAt <= Date.now() : false;

  // "Login as Owner": behave exactly as the borrowed tenant user — no bypass.
  if (imp?.mode === "AS_USER") {
    return {
      userId: imp.actingAsUserId ?? user.id,
      roleId: user.salonRoleId ?? null,
      role: user.salonRole ?? null,
      salonId: user.salonId,
      isSuperAdmin: false,
      expired,
    };
  }

  // PLATFORM impersonation, or an ordinary user / legacy super admin pinned to a salon.
  const bypass = user.isSuperAdmin && (!imp || imp.mode === "PLATFORM");
  return {
    userId: user.id,
    roleId: user.salonRoleId ?? null,
    role: user.salonRole ?? (bypass ? SYSTEM_ROLES.OWNER : null),
    salonId: user.salonId,
    isSuperAdmin: bypass,
    expired,
  };
}
