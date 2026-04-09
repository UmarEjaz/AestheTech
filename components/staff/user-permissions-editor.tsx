"use client";

import { useState, useCallback } from "react";
import { Loader2, RotateCcw, ShieldCheck, ShieldX, ShieldMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  UserPermissionOverrideData,
  updateUserPermissions,
  clearUserPermissionOverrides,
} from "@/lib/actions/permission";
import { MODULE_LABELS, OWNER_LOCKED_PERMISSIONS, OWNER_ROLE_NAME } from "@/lib/permissions-defaults";
import { useRoleLabel } from "@/lib/roles-context";

interface UserPermissionsEditorProps {
  data: UserPermissionOverrideData;
}

type OverrideState = "inherit" | "GRANT" | "REVOKE";

export function UserPermissionsEditor({ data }: UserPermissionsEditorProps) {
  const targetRoleLabel = useRoleLabel(data.targetUser.role);

  const buildInitialState = useCallback(() => {
    const state: Record<string, OverrideState> = {};
    for (const perm of data.permissions) {
      state[perm.code] = data.overrides[perm.code] || "inherit";
    }
    return state;
  }, [data.permissions, data.overrides]);

  const [overrideState, setOverrideState] = useState(buildInitialState);
  const [initialState] = useState(buildInitialState);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Group permissions by module
  const modules = new Map<string, typeof data.permissions>();
  for (const perm of data.permissions) {
    if (!modules.has(perm.module)) modules.set(perm.module, []);
    modules.get(perm.module)!.push(perm);
  }

  const hasChanges = Object.keys(overrideState).some(
    (key) => overrideState[key] !== initialState[key]
  );

  const overrideCount = Object.values(overrideState).filter((v) => v !== "inherit").length;

  const isLocked = (permCode: string) =>
    data.targetUser.role === OWNER_ROLE_NAME && OWNER_LOCKED_PERMISSIONS.includes(permCode);

  const handleChange = (permCode: string, value: OverrideState) => {
    if (isLocked(permCode)) return;
    setOverrideState((prev) => ({ ...prev, [permCode]: value }));
  };

  const getEffectiveAccess = (permCode: string): boolean => {
    const state = overrideState[permCode];
    if (state === "GRANT") return true;
    if (state === "REVOKE") return false;
    return data.rolePermissions.includes(permCode);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Collect only non-inherit overrides
      const overrides: Array<{ permissionCode: string; overrideType: "GRANT" | "REVOKE" }> = [];
      for (const [code, state] of Object.entries(overrideState)) {
        if (state !== "inherit") {
          overrides.push({ permissionCode: code, overrideType: state });
        }
      }

      const result = await updateUserPermissions({
        userId: data.targetUser.id,
        overrides,
      });

      if (result.success) {
        toast.success("User permission overrides saved");
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to save user permissions");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      const result = await clearUserPermissionOverrides(data.targetUser.id);
      if (result.success) {
        toast.success("All overrides cleared — user reverted to role defaults");
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to clear overrides");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Permission Overrides</CardTitle>
            <CardDescription>
              Custom permissions for {data.targetUser.firstName} {data.targetUser.lastName} ({targetRoleLabel}).
              {overrideCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Array.from(modules.entries()).map(([module, perms]) => (
          <div key={module} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground">
              {MODULE_LABELS[module] || module}
            </h4>
            <div className="space-y-1">
              {perms.map((perm) => {
                const locked = isLocked(perm.code);
                const state = overrideState[perm.code];
                const roleHas = data.rolePermissions.includes(perm.code);
                const effective = getEffectiveAccess(perm.code);

                return (
                  <div
                    key={perm.code}
                    className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {effective ? (
                        <ShieldCheck className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <ShieldX className="h-4 w-4 text-red-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{perm.label}</div>
                        {perm.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {perm.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role default badge */}
                      <Badge
                        variant="outline"
                        className={`text-xs ${roleHas ? "text-green-600 border-green-200" : "text-red-400 border-red-200"}`}
                      >
                        Role: {roleHas ? "Yes" : "No"}
                      </Badge>

                      {/* Override selector */}
                      <Select
                        value={state}
                        onValueChange={(v) => handleChange(perm.code, v as OverrideState)}
                        disabled={locked || isSaving}
                      >
                        <SelectTrigger className={`w-[130px] h-8 text-xs ${locked ? "opacity-50" : ""}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            <span className="flex items-center gap-1.5">
                              <ShieldMinus className="h-3 w-3" />
                              Inherit
                            </span>
                          </SelectItem>
                          <SelectItem value="GRANT">
                            <span className="flex items-center gap-1.5">
                              <ShieldCheck className="h-3 w-3 text-green-500" />
                              Grant
                            </span>
                          </SelectItem>
                          <SelectItem value="REVOKE">
                            <span className="flex items-center gap-1.5">
                              <ShieldX className="h-3 w-3 text-red-500" />
                              Revoke
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-4 border-t">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isClearing || isSaving || overrideCount === 0}
              >
                {isClearing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Clear All Overrides
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear All Overrides?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove all custom permission overrides for{" "}
                  {data.targetUser.firstName} {data.targetUser.lastName}. They will revert to
                  their role&apos;s default permissions.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClear}>Clear All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving || isClearing}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Overrides
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
