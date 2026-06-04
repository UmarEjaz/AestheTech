"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShieldAlert, X } from "lucide-react";
import { exitImpersonation, getActiveImpersonation } from "@/lib/actions/impersonation";
import { useRoleLabel } from "@/lib/roles-context";
import type { ActiveImpersonation } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Split/segmented impersonation indicator for the header (variant 6). Renders
 * nothing unless a super admin is actively viewing a salon. The left segment
 * shows the role being viewed (Super Admin in PLATFORM mode, or the borrowed
 * role such as Owner in AS_USER mode) + the salon; the right (dark) segment
 * holds the live countdown and a one-click exit.
 */
export function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [info, setInfo] = useState<ActiveImpersonation | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [isPending, startTransition] = useTransition();

  const sessionId = session?.user?.impersonation?.sessionId ?? null;
  // In AS_USER mode the session carries the borrowed role slug; null in PLATFORM mode.
  const borrowedRoleLabel = useRoleLabel(session?.user?.salonRole ?? "");

  // Load display details (salon name, acting user) whenever the active session changes.
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setInfo(null);
      return;
    }
    getActiveImpersonation().then((res) => {
      if (!cancelled) setInfo(res.success ? res.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleExit = useCallback(() => {
    startTransition(async () => {
      await exitImpersonation();
      await update({ impersonation: null });
      router.push("/admin");
      router.refresh();
    });
  }, [router, update]);

  // Countdown + auto-exit on expiry.
  useEffect(() => {
    if (!info) return;
    const expiry = new Date(info.expiresAt).getTime();
    const tick = () => {
      const left = expiry - Date.now();
      setRemaining(left);
      if (left <= 0) handleExit();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info, handleExit]);

  if (!info) return null;

  // The role/identity being viewed — what the user is "logged in as".
  const viewingAs =
    info.mode === "AS_USER" ? borrowedRoleLabel || info.actingAsName || "User" : "Super Admin";
  const fullLabel =
    info.mode === "AS_USER"
      ? `Viewing ${info.salonName} as ${viewingAs}`
      : `Viewing ${info.salonName} as Super Admin (full access)`;

  return (
    <div
      title={fullLabel}
      className="flex items-stretch overflow-hidden rounded-full border border-amber-500/50 text-xs font-medium"
    >
      {/* Left segment: who you're viewing as + salon */}
      <div className="flex items-center gap-1.5 bg-amber-500/10 py-1 pl-2.5 pr-2.5 text-amber-900 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline whitespace-nowrap">
          {viewingAs} · <span className="font-semibold">{info.salonName}</span>
        </span>
      </div>

      {/* Right (dark) segment: live countdown + one-click exit */}
      <div className="flex items-center gap-1 bg-amber-600 py-1 pl-2.5 pr-1 text-white dark:bg-amber-700">
        <span className="tabular-nums">{formatRemaining(remaining)}</span>
        <button
          type="button"
          onClick={handleExit}
          disabled={isPending}
          title="Exit and return to admin"
          aria-label="Exit and return to admin"
          className={cn(
            "flex items-center justify-center h-6 w-6 rounded-full",
            "hover:bg-white/25 transition-colors disabled:opacity-50"
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
