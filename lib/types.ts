export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Active impersonation/support session details for display (banner, etc.). */
export interface ActiveImpersonation {
  sessionId: string;
  mode: "PLATFORM" | "AS_USER";
  salonId: string;
  salonName: string;
  actingAsUserId: string | null;
  actingAsName: string | null;
  expiresAt: string; // ISO
}
