"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2 } from "lucide-react";
import { getUserSalons, switchSalon } from "@/lib/actions/salon";
import type { UserSalon } from "@/lib/actions/salon";

export default function SelectSalonPage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [salons, setSalons] = useState<UserSalon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");

  const isSuperAdmin = session?.user?.isSuperAdmin ?? false;
  const userName = session?.user?.name ?? "User";

  // Fetch user's salons on mount
  useEffect(() => {
    async function fetchSalons() {
      setIsLoading(true);
      const result = await getUserSalons();

      if (!result.success) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      const data = result.data;

      // Auto-select if only 1 salon
      if (data.length === 1) {
        await handleSelectSalon(data[0].id);
        return;
      }

      setSalons(data);
      setIsLoading(false);
    }

    fetchSalons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectSalon(salonId: string) {
    setIsSwitching(salonId);
    setError("");

    const result = await switchSalon(salonId);

    if (!result.success) {
      setError(result.error);
      setIsSwitching(null);
      return;
    }

    // Update the JWT session with the selected salon
    await update({
      salonId: result.data.salonId,
      salonRole: result.data.salonRole,
    });

    router.push("/dashboard");
    router.refresh();
  }

  function getRoleBadgeVariant(role: string) {
    switch (role) {
      case "OWNER":
        return "default";
      case "ADMIN":
        return "secondary";
      case "STAFF":
        return "outline";
      case "RECEPTIONIST":
        return "outline";
      default:
        return "outline";
    }
  }

  function formatRole(role: string) {
    return role.charAt(0) + role.slice(1).toLowerCase();
  }

  function formatSubscriptionStatus(status: string) {
    switch (status) {
      case "ACTIVE":
        return { label: "Active", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" };
      case "TRIAL":
        return { label: "Trial", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" };
      case "SUSPENDED":
        return { label: "Suspended", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" };
      case "CANCELLED":
        return { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" };
      default:
        return { label: status, className: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400" };
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading your salons...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header card */}
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center">
                <span className="text-2xl font-bold text-primary-foreground">A</span>
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">
              Welcome back, {userName}
            </CardTitle>
            <CardDescription>
              Select a salon to continue
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Error state */}
        {error && (
          <div className="text-sm text-destructive text-center bg-destructive/10 py-3 px-4 rounded-md">
            {error}
          </div>
        )}

        {/* Empty state */}
        {salons.length === 0 && !error && (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                You are not a member of any active salon.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Contact your salon administrator to get access.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Salon cards grid */}
        {salons.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {salons.map((salon) => {
              const status = formatSubscriptionStatus(salon.subscriptionStatus);
              const isCurrentlySwitching = isSwitching === salon.id;
              const isDisabled = isSwitching !== null;

              return (
                <button
                  key={salon.id}
                  onClick={() => handleSelectSalon(salon.id)}
                  disabled={isDisabled}
                  className="text-left w-full"
                  aria-label={`Select ${salon.name}`}
                >
                  <Card
                    className={`transition-all hover:shadow-md hover:border-primary/50 cursor-pointer ${
                      isCurrentlySwitching
                        ? "border-primary ring-2 ring-primary/20"
                        : ""
                    } ${isDisabled && !isCurrentlySwitching ? "opacity-50" : ""}`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-base truncate">
                            {salon.name}
                          </h3>
                          {salon.address && (
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {salon.address}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge variant={getRoleBadgeVariant(salon.role)}>
                              {formatRole(salon.role)}
                            </Badge>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                          </div>
                        </div>
                        {isCurrentlySwitching && (
                          <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
        )}

        {/* Super Admin note */}
        {isSuperAdmin && (
          <Card className="border-dashed">
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-3">
                <Badge variant="default" className="flex-shrink-0">
                  Super Admin
                </Badge>
                <p className="text-sm text-muted-foreground">
                  You can also access{" "}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => router.push("/admin")}
                    disabled={isSwitching !== null}
                  >
                    /admin
                  </Button>{" "}
                  for platform-level management.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
