"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { getUserSalons, switchSalon, UserSalonItem } from "@/lib/actions/salon-switch";
import { toast } from "sonner";

export function SalonSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [salons, setSalons] = useState<UserSalonItem[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function load() {
      const result = await getUserSalons();
      if (result.success) {
        setSalons(result.data);
      }
    }
    load();
  }, [session?.user?.salonId]);

  const currentSalon = salons.find((s) => s.isCurrent);

  async function handleSwitch(targetSalonId: string) {
    startTransition(async () => {
      const result = await switchSalon(targetSalonId);
      if (result.success) {
        await update({
          salonId: result.data.salonId,
          salonRole: result.data.role,
        });
        router.refresh();
        toast.success(`Switched to ${salons.find((s) => s.salonId === targetSalonId)?.salonName}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  // If user has only 1 salon, just show the name
  if (salons.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        <span className="hidden md:inline truncate max-w-[150px]">
          {currentSalon?.salonName || "Loading..."}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 max-w-[200px]"
          disabled={isPending}
        >
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <span className="hidden md:inline truncate">
            {currentSalon?.salonName || "Loading..."}
          </span>
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch Salon</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {salons.map((salon) => (
          <DropdownMenuItem
            key={salon.salonId}
            onClick={() => {
              if (!salon.isCurrent) handleSwitch(salon.salonId);
            }}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              {salon.isCurrent && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
              {!salon.isCurrent && <div className="w-4" />}
              <span className="truncate">{salon.salonName}</span>
            </div>
            <Badge variant="secondary" className="text-xs capitalize ml-2 flex-shrink-0">
              {salon.role.toLowerCase()}
            </Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
