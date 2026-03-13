"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, ChevronDown, Check, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getUserSalons, switchSalon, type UserSalon } from "@/lib/actions/salon";

export function SalonSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [salons, setSalons] = useState<UserSalon[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);

  const currentSalonId = session?.user?.salonId;
  const isSuperAdmin = session?.user?.isSuperAdmin ?? false;

  // Find the current salon name from loaded salons
  const currentSalon = salons.find((s) => s.id === currentSalonId);

  const fetchSalons = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUserSalons();
      if (result.success) {
        setSalons(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch salons when dropdown opens
  useEffect(() => {
    if (open) {
      fetchSalons();
    }
  }, [open, fetchSalons]);

  const handleSwitch = async (salonId: string) => {
    if (salonId === currentSalonId) return;

    setSwitching(true);
    try {
      const result = await switchSalon(salonId);
      if (result.success) {
        // Update the NextAuth session with the new salon
        await update({
          salonId: result.data.salonId,
          salonRole: result.data.salonRole,
        });
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2 max-w-[200px]"
          aria-label="Switch salon"
        >
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <span className="truncate text-sm">
            {currentSalon?.name ?? "Select Salon"}
          </span>
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch Salon
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading salons...</span>
          </div>
        ) : salons.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No salons available
          </div>
        ) : (
          salons.map((salon) => {
            const isCurrent = salon.id === currentSalonId;
            return (
              <DropdownMenuItem
                key={salon.id}
                onClick={() => handleSwitch(salon.id)}
                disabled={switching}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{salon.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {salon.role.toLowerCase().replace("_", " ")}
                  </span>
                </div>
                {isCurrent && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                {switching && !isCurrent && (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                )}
              </DropdownMenuItem>
            );
          })
        )}

        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href="/admin/salons"
                className="flex items-center gap-2 cursor-pointer"
              >
                <Settings2 className="h-4 w-4" />
                <span>Manage Salons</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
