"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginAsUser } from "@/lib/actions/impersonation";

interface UserImpersonationActionProps {
  salonId: string;
  userId: string;
  userName: string;
  disabled?: boolean;
}

export function UserImpersonationAction({
  salonId,
  userId,
  userName,
  disabled = false,
}: UserImpersonationActionProps) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const res = await loginAsUser(salonId, userId);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        await update({ impersonation: { sessionId: res.data.sessionId } });
        toast.success(`Logged in as ${userName}`);
        router.push("/dashboard");
        router.refresh();
      } catch (error) {
        console.error("Failed to log in as user:", error);
        toast.error("Failed to log in as user. Please try again.");
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled || isPending}
      onClick={handleClick}
      title={`Log in as ${userName}`}
    >
      <LogIn className="h-4 w-4 mr-1" />
      Login as
    </Button>
  );
}
