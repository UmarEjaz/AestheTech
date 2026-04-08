"use client";

import { useState, useCallback } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { PermissionMatrixData, updatePermissions, resetPermissionsToDefaults } from "@/lib/actions/permission";
import { OWNER_LOCKED_PERMISSIONS, OWNER_ROLE_NAME, MODULE_LABELS } from "@/lib/permissions-defaults";

interface PermissionsMatrixProps {
  data: PermissionMatrixData;
}

export function PermissionsMatrix({ data }: PermissionsMatrixProps) {
  // Build a label map from the roles data
  const roleLabelMap = new Map(data.roles.map((r) => [r.name, r.label]));

  // Build initial state: { "clients:view:OWNER": true, ... }
  const buildStateFromAssignments = useCallback(
    (assignments: Record<string, string[]>) => {
      const state: Record<string, boolean> = {};
      for (const perm of data.permissions) {
        for (const role of data.roles) {
          const key = `${perm.code}:${role.name}`;
          state[key] = (assignments[perm.code] || []).includes(role.name);
        }
      }
      return state;
    },
    [data.permissions, data.roles]
  );

  const [checkState, setCheckState] = useState(() => buildStateFromAssignments(data.assignments));
  const [initialState] = useState(() => buildStateFromAssignments(data.assignments));
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Group permissions by module
  const modules = new Map<string, typeof data.permissions>();
  for (const perm of data.permissions) {
    if (!modules.has(perm.module)) modules.set(perm.module, []);
    modules.get(perm.module)!.push(perm);
  }

  const isLocked = (permCode: string, roleName: string) =>
    roleName === OWNER_ROLE_NAME && OWNER_LOCKED_PERMISSIONS.includes(permCode);

  const hasChanges = Object.keys(checkState).some((key) => checkState[key] !== initialState[key]);

  const handleToggle = (permCode: string, roleName: string) => {
    if (isLocked(permCode, roleName)) return;
    const key = `${permCode}:${roleName}`;
    setCheckState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Compute diff from initial state
      const assignments: Array<{ permissionCode: string; role: string; granted: boolean }> = [];
      for (const key of Object.keys(checkState)) {
        if (checkState[key] !== initialState[key]) {
          const lastColon = key.lastIndexOf(":");
          const permCode = key.substring(0, lastColon);
          const roleName = key.substring(lastColon + 1);
          assignments.push({
            permissionCode: permCode,
            role: roleName,
            granted: checkState[key],
          });
        }
      }

      if (assignments.length === 0) {
        toast.info("No changes to save");
        return;
      }

      const result = await updatePermissions({ assignments });
      if (result.success) {
        toast.success("Permissions updated successfully");
        // Reload to reflect changes
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to save permissions");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const result = await resetPermissionsToDefaults();
      if (result.success) {
        toast.success("Permissions reset to defaults");
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to reset permissions");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {Array.from(modules.entries()).map(([module, perms]) => (
        <Card key={module}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{MODULE_LABELS[module] || module}</CardTitle>
            <CardDescription>
              {perms.length} permission{perms.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 text-sm font-medium text-muted-foreground min-w-[200px]">
                      Permission
                    </th>
                    {data.roles.map((role) => (
                      <th
                        key={role.name}
                        className="text-center py-2 px-3 text-sm font-medium text-muted-foreground min-w-[100px]"
                      >
                        <span
                          className="inline-flex items-center gap-1.5"
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: role.color }}
                          />
                          {role.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perms.map((perm) => (
                    <tr key={perm.code} className="border-b last:border-b-0 hover:bg-muted/50">
                      <td className="py-3 pr-4">
                        <div className="text-sm font-medium">{perm.label}</div>
                        {perm.description && (
                          <div className="text-xs text-muted-foreground">{perm.description}</div>
                        )}
                      </td>
                      {data.roles.map((role) => {
                        const key = `${perm.code}:${role.name}`;
                        const locked = isLocked(perm.code, role.name);
                        return (
                          <td key={role.name} className="text-center py-3 px-3">
                            <Checkbox
                              checked={checkState[key]}
                              onCheckedChange={() => handleToggle(perm.code, role.name)}
                              disabled={locked || isSaving}
                              aria-label={`${perm.label} for ${roleLabelMap.get(role.name) || role.name}`}
                              className={locked ? "opacity-50 cursor-not-allowed" : ""}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Action buttons */}
      <div className="flex items-center justify-between sticky bottom-4 bg-background/95 backdrop-blur p-4 border rounded-lg shadow-lg">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isResetting || isSaving}>
              {isResetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset to Defaults
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Permissions?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reset all role permissions to their default values. Any custom changes will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
