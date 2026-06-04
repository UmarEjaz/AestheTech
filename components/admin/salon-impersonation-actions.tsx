"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { LogIn, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterSalon, loginAsOwner } from "@/lib/actions/impersonation";

interface SalonImpersonationActionsProps {
  salonId: string;
  salonName: string;
  /** "row" = compact icon buttons for tables; "detail" = full-width labelled buttons. */
  variant?: "row" | "detail";
  disabled?: boolean;
}

export function SalonImpersonationActions({
  salonId,
  salonName,
  variant = "row",
  disabled = false,
}: SalonImpersonationActionsProps) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  function activate(
    fn: () => Promise<
      | { success: true; data: { sessionId: string; expiresAt: string } }
      | { success: false; error: string }
    >,
    successMsg: string
  ) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        // Activate the impersonation session in the token, then drop into the salon.
        await update({ impersonation: { sessionId: res.data.sessionId } });
        toast.success(successMsg);
        router.push("/dashboard");
        router.refresh();
      } catch (error) {
        console.error("Failed to start impersonation:", error);
        toast.error("Failed to start impersonation. Please try again.");
      }
    });
  }

  const compact = variant === "row";

  return (
    <div className={compact ? "flex items-center justify-end gap-1" : "flex flex-col sm:flex-row gap-2"}>
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        variant="default"
        disabled={disabled || isPending}
        onClick={() => activate(() => enterSalon(salonId), `Entered ${salonName} as Super Admin`)}
        title="Enter salon as Super Admin (unrestricted)"
      >
        <LogIn className={compact ? "h-4 w-4" : "h-4 w-4 mr-2"} />
        {compact ? <span className="sr-only">Enter salon</span> : "Enter salon"}
      </Button>
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        variant="outline"
        disabled={disabled || isPending}
        onClick={() => activate(() => loginAsOwner(salonId), `Logged in as the owner of ${salonName}`)}
        title="Log in as this salon's owner (see what they see)"
      >
        <UserCog className={compact ? "h-4 w-4" : "h-4 w-4 mr-2"} />
        {compact ? <span className="sr-only">Login as Owner</span> : "Login as Owner"}
      </Button>
    </div>
  );
}
