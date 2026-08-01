"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, Trash2, Edit, Lock, RotateCcw, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RoleForm } from "@/components/settings/role-form";
import { deleteRole, getRoleBySlug, type RoleInfo } from "@/lib/actions/role";
import { updateRolePermissions, resetRolePermissionsToDefaults } from "@/lib/actions/permission";
import { MODULE_LABELS } from "@/lib/permissions-defaults";

type PermissionInfo = {
  code: string;
  module: string;
  label: string;
  description: string | null;
  sortOrder: number;
};

// Sibling modules that share a card. The parent module's position in the
// modules Map determines where the combined card appears.
const MODULE_PAIRS: { parent: string; child: string; title: string }[] = [
  { parent: "products", child: "product-categories", title: "Products" },
  { parent: "services", child: "service-categories", title: "Services" },
  { parent: "expenses", child: "expense-categories", title: "Expenses" },
];

// Small singleton modules bundled into one card. The bundle appears at the
// position of the first member encountered in iteration order. Order of
// members within the bundle is determined by this array.
const SINGLETON_BUNDLE: { modules: string[]; title: string } = {
  modules: ["audit", "data", "profit", "reports"],
  title: "Visibility & Insights",
};

type DisplayGroup = {
  key: string;
  title: string;
  sections: { label: string | null; perms: PermissionInfo[] }[];
};

type PermissionData = {
  role: RoleInfo;
  permissions: PermissionInfo[];
  grantedPermissions: string[];
  callerHierarchyLevel: number;
};

interface RolesPageClientProps {
  roles: RoleInfo[];
  initialPermData: PermissionData | null;
  canManageRoles: boolean;
  canManagePermissions: boolean;
}

export function RolesPageClient({ roles, initialPermData, canManageRoles, canManagePermissions }: RolesPageClientProps) {
  // Role selection
  const [selectedSlug, setSelectedSlug] = useState(
    initialPermData?.role.slug ?? ""
  );
  const [permData, setPermData] = useState<PermissionData | null>(initialPermData);
  const [isLoadingPerms, setIsLoadingPerms] = useState(false);

  // Permission editing
  const [granted, setGranted] = useState<Set<string>>(
    () => new Set(initialPermData?.grantedPermissions ?? [])
  );
  const [initialGranted, setInitialGranted] = useState<Set<string>>(
    () => new Set(initialPermData?.grantedPermissions ?? [])
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Role CRUD
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleInfo | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedRole = permData?.role;
  const isReadOnly = !canManagePermissions || (selectedRole
    ? selectedRole.hierarchyLevel >= (permData?.callerHierarchyLevel ?? 0)
    : true);

  // Group permissions by module
  const modules = useMemo(() => {
    if (!permData) return new Map<string, PermissionInfo[]>();
    const map = new Map<string, PermissionInfo[]>();
    for (const perm of permData.permissions) {
      if (!map.has(perm.module)) map.set(perm.module, []);
      map.get(perm.module)!.push(perm);
    }
    return map;
  }, [permData]);

  // Build display groups: merge sibling pairs (Products + Product Categories,
  // etc.) into pair cards, and bundle small singleton modules (Audit Log, Data
  // Access, Profit Analytics, Reports) into one card. Pair cards leave the
  // parent section unlabeled; bundle cards label every section. Both card
  // types occupy the position of their first member in iteration order.
  const displayGroups = useMemo<DisplayGroup[]>(() => {
    const groups: DisplayGroup[] = [];

    // Pre-compute which modules are consumed by merged cards.
    const pairedChildren = new Set<string>();
    for (const pair of MODULE_PAIRS) {
      if (modules.has(pair.parent) && modules.has(pair.child)) {
        pairedChildren.add(pair.child);
      }
    }
    const bundledModules = new Set<string>(
      SINGLETON_BUNDLE.modules.filter((m) => modules.has(m))
    );
    let bundleEmitted = false;

    for (const [module, perms] of modules.entries()) {
      if (pairedChildren.has(module)) continue;

      // Singleton bundle — emit once, at the first encountered member.
      if (bundledModules.has(module)) {
        if (bundleEmitted) continue;
        bundleEmitted = true;
        const sections = SINGLETON_BUNDLE.modules
          .map((m) => {
            const memberPerms = modules.get(m);
            if (!memberPerms) return null;
            return { label: MODULE_LABELS[m] || m, perms: memberPerms };
          })
          .filter((s): s is { label: string; perms: PermissionInfo[] } => s !== null);
        groups.push({
          key: "bundle:singletons",
          title: SINGLETON_BUNDLE.title,
          sections,
        });
        continue;
      }

      const pair = MODULE_PAIRS.find((p) => p.parent === module);
      const childPerms = pair ? modules.get(pair.child) : undefined;
      if (pair && childPerms) {
        groups.push({
          key: `pair:${module}`,
          title: pair.title,
          sections: [
            // Parent section has no sub-label — the card title already names it.
            { label: null, perms },
            { label: MODULE_LABELS[pair.child] || pair.child, perms: childPerms },
          ],
        });
      } else {
        groups.push({
          key: module,
          title: MODULE_LABELS[module] || module,
          sections: [{ label: null, perms }],
        });
      }
    }

    return groups;
  }, [modules]);

  const isPermDisabled = useCallback(
    (_code: string) => {
      if (isReadOnly) return true;
      return false;
    },
    [isReadOnly]
  );

  // Compute changes
  const changes = useMemo(() => {
    const grants: string[] = [];
    const revokes: string[] = [];
    for (const code of granted) {
      if (!initialGranted.has(code)) grants.push(code);
    }
    for (const code of initialGranted) {
      if (!granted.has(code)) revokes.push(code);
    }
    return { grants, revokes, count: grants.length + revokes.length };
  }, [granted, initialGranted]);

  // ---------- Role selection ----------

  const handleSelectRole = async (slug: string) => {
    if (slug === selectedSlug && permData?.role.slug === slug) return;

    if (changes.count > 0) {
      const confirmed = window.confirm(
        `You have ${changes.count} unsaved change(s). Discard them?`
      );
      if (!confirmed) return;
    }

    setIsLoadingPerms(true);

    try {
      const result = await getRoleBySlug(slug);
      if (result.success) {
        setSelectedSlug(slug);
        setPermData(result.data);
        setGranted(new Set(result.data.grantedPermissions));
        setInitialGranted(new Set(result.data.grantedPermissions));
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to load role permissions");
    } finally {
      setIsLoadingPerms(false);
    }
  };

  // Validate that :view is granted when any :create/:update/:delete is granted
  const validateViewDependencies = useCallback((): string[] => {
    if (!permData) return [];

    const allCodes = permData.permissions.map((p) => p.code);

    // Find all prefixes that have a :view permission (e.g., "clients", "payroll", "salary-config")
    const viewPrefixes = new Set<string>();
    for (const code of allCodes) {
      if (code.endsWith(":view")) {
        viewPrefixes.add(code.slice(0, code.lastIndexOf(":view")));
      }
    }

    const violations: string[] = [];
    for (const prefix of viewPrefixes) {
      const viewCode = `${prefix}:view`;
      if (granted.has(viewCode)) continue;

      // Check if any non-view permission with this prefix is granted
      const hasNonView = allCodes.some(
        (code) =>
          code.startsWith(`${prefix}:`) &&
          code !== viewCode &&
          granted.has(code)
      );

      if (hasNonView) {
        // Use the module label for a user-friendly name
        const perm = permData.permissions.find((p) => p.code === viewCode);
        const moduleLabel = perm
          ? MODULE_LABELS[perm.module] || perm.module
          : prefix;
        violations.push(moduleLabel);
      }
    }

    return [...new Set(violations)];
  }, [permData, granted]);

  // ---------- Permission editing ----------

  const handleToggle = (code: string) => {
    if (isPermDisabled(code)) return;
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedRole || changes.count === 0) return;

    const violations = validateViewDependencies();
    if (violations.length > 0) {
      toast.error(
        `Cannot save: View permission is required for ${violations.join(", ")}`
      );
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateRolePermissions({
        roleDefinitionId: selectedRole.id,
        grants: changes.grants,
        revokes: changes.revokes,
      });
      if (result.success) {
        toast.success("Permissions updated successfully");
        setInitialGranted(new Set(granted));
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
    if (!selectedRole) return;
    setIsResetting(true);
    try {
      const result = await resetRolePermissionsToDefaults(selectedRole.id);
      if (result.success) {
        toast.success("Permissions reset to defaults");
        const reloadResult = await getRoleBySlug(selectedSlug);
        if (reloadResult.success) {
          setPermData(reloadResult.data);
          setGranted(new Set(reloadResult.data.grantedPermissions));
          setInitialGranted(new Set(reloadResult.data.grantedPermissions));
        }
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to reset permissions");
    } finally {
      setIsResetting(false);
    }
  };

  // ---------- Role CRUD ----------

  const handleEdit = (e: React.MouseEvent, role: RoleInfo) => {
    e.stopPropagation();
    setEditingRole(role);
    setShowForm(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, roleId: string) => {
    e.stopPropagation();
    setDeletingId(roleId);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      const result = await deleteRole(deletingId);
      if (result.success) {
        toast.success("Role deleted successfully");
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to delete role");
    } finally {
      setIsDeleting(false);
      setDeletingId(null);
    }
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingRole(undefined);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/settings">
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Back to settings</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Roles & Permissions</h1>
            <p className="text-muted-foreground">
              Select a role to view and edit its permissions
            </p>
          </div>
        </div>
        {canManageRoles && (
          <Button
            onClick={() => {
              setEditingRole(undefined);
              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Custom Role
          </Button>
        )}
      </div>

      {/* Mobile role selector */}
      <div className="lg:hidden">
        <Select value={selectedSlug} onValueChange={handleSelectRole}>
          <SelectTrigger>
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.slug} value={role.slug}>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: role.color }}
                  />
                  {role.name}
                  <span className="text-muted-foreground text-xs">
                    ({role.isSystem ? "System" : "Custom"})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Split layout */}
      <div className="flex gap-6">
        {/* Left: Role list (desktop) */}
        <div className="hidden lg:block w-60 shrink-0">
          <div className="sticky top-24 bg-background border rounded-xl overflow-hidden">
            {roles.map((role) => (
              <div
                key={role.slug}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectRole(role.slug)}
                onKeyDown={(e) => {
                  // Ignore key events that bubbled from inner Edit/Delete buttons —
                  // otherwise activating those buttons via keyboard would also re-select
                  // the row before the button's own action runs.
                  if (e.currentTarget !== e.target) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectRole(role.slug);
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-left transition-colors group cursor-pointer",
                  selectedSlug === role.slug
                    ? "bg-primary/5 border-l-[3px] border-l-primary"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: role.color }}
                />
                <TooltipProvider delayDuration={200}>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm font-semibold truncate">
                          {role.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        {role.description || "No description"}
                      </TooltipContent>
                    </Tooltip>
                    {role.isSystem && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          System role — cannot be renamed or deleted.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!role.isSystem && canManageRoles && (
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={(e) => handleEdit(e, role)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit role</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* Span wrapper so the tooltip still fires when the button is disabled
                                (disabled buttons don't dispatch hover events). */}
                            <span className="inline-flex">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-red-100 dark:hover:bg-red-900/20 hover:text-red-600"
                                onClick={(e) => handleDeleteClick(e, role.id)}
                                disabled={(role.userCount ?? 0) > 0}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {(role.userCount ?? 0) > 0
                              ? `${role.userCount} user(s) assigned. Reassign them to a different role before deleting.`
                              : "Delete role"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                    <span className="text-[11px] text-muted-foreground tabular-nums ml-1">
                      {role.userCount ?? 0}
                    </span>
                  </div>
                </TooltipProvider>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Permissions panel */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Selected role header */}
          {selectedRole && (
            <div className="bg-background border rounded-xl p-5 flex items-center gap-4">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full shrink-0"
                style={{ backgroundColor: selectedRole.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold">{selectedRole.name}</h2>
                  <Badge
                    variant={selectedRole.isSystem ? "secondary" : "default"}
                    className={
                      !selectedRole.isSystem
                        ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                        : ""
                    }
                  >
                    {selectedRole.isSystem ? "System" : "Custom"}
                  </Badge>
                  {isReadOnly && (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="h-3 w-3" />
                      View Only
                    </Badge>
                  )}
                </div>
                {selectedRole.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedRole.description}
                  </p>
                )}
              </div>
              <div className="hidden sm:flex gap-6 shrink-0">
                <div className="text-center">
                  <div className="text-lg font-bold text-primary">
                    {granted.size}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Granted
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">
                    {permData?.permissions.length ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Total</div>
                </div>
              </div>
            </div>
          )}

          {/* Permission grid */}
          {isLoadingPerms ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : permData ? (
            <div className="bg-background border rounded-xl p-6">
              {!isReadOnly && (
                <div className="flex items-center gap-2 mb-4 pb-4 border-b text-sm text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0" />
                  <p>View permission is required when granting Create, Update, or Delete for any module.</p>
                </div>
              )}
              {/* CSS columns (masonry) layout — modules pack vertically into each
                  column with no empty gaps. `break-inside-avoid` keeps each module
                  intact within a single column. Sibling pairs (Products + Product
                  Categories, etc.) are merged into a single card with two
                  subsections. */}
              <div className="columns-1 md:columns-2 xl:columns-3 gap-x-8">
                {displayGroups.map((group) => {
                  // Pair cards: header count = parent only (first section unlabeled).
                  // Bundle cards: header count = combined total (all sections labeled).
                  // Solo cards: header count = the single section.
                  const isMerged = group.sections.length > 1;
                  const isBundled = isMerged && group.sections[0].label !== null;
                  const totalPerms = isBundled
                    ? group.sections.reduce((s, sec) => s + sec.perms.length, 0)
                    : group.sections[0].perms.length;
                  const totalGranted = isBundled
                    ? group.sections.reduce(
                        (s, sec) =>
                          s + sec.perms.filter((p) => granted.has(p.code)).length,
                        0
                      )
                    : group.sections[0].perms.filter((p) => granted.has(p.code))
                        .length;
                  return (
                    <div
                      key={group.key}
                      className={cn(
                        "break-inside-avoid mb-6",
                        isMerged && "border-l-2 border-primary/70 pl-3"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-bold">{group.title}</h3>
                        <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                          {totalGranted}/{totalPerms}
                        </span>
                      </div>
                      {group.sections.map((section, idx) => {
                        const sectionGranted = section.perms.filter((p) =>
                          granted.has(p.code)
                        ).length;
                        return (
                          <div
                            key={section.label ?? "solo"}
                            className={cn(
                              idx > 0 && "mt-3 pt-3 border-t border-dashed border-border/60"
                            )}
                          >
                            {section.label && (
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  {section.label}
                                </h4>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {sectionGranted}/{section.perms.length}
                                </span>
                              </div>
                            )}
                            <div className="space-y-1">
                              {section.perms.map((perm) => {
                                const isOn = granted.has(perm.code);
                                const disabled =
                                  isPermDisabled(perm.code) ||
                                  isSaving ||
                                  isResetting;
                                return (
                                  <div
                                    key={perm.code}
                                    className="flex items-center gap-2.5 py-1"
                                  >
                                    <Switch
                                      checked={isOn}
                                      onCheckedChange={() =>
                                        handleToggle(perm.code)
                                      }
                                      disabled={disabled}
                                      className="scale-[0.85]"
                                      aria-label={perm.label}
                                    />
                                    <span
                                      className={cn(
                                        "text-[13px]",
                                        isOn
                                          ? "font-medium text-foreground"
                                          : "text-muted-foreground",
                                        disabled && "opacity-60"
                                      )}
                                    >
                                      {perm.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              Select a role to view its permissions
            </div>
          )}
        </div>
      </div>

      {/* Sticky save bar */}
      {!isReadOnly && permData && (
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
                  This will reset all permissions for the{" "}
                  <strong>{selectedRole?.name}</strong> role to their default
                  values. Any custom changes will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex items-center gap-3">
            {changes.count > 0 && (
              <span className="text-sm text-muted-foreground">
                {changes.count} change{changes.count !== 1 ? "s" : ""}
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={changes.count === 0 || isSaving}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Create/Edit role dialog */}
      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? "Edit Role" : "Create Custom Role"}
            </DialogTitle>
          </DialogHeader>
          <RoleForm role={editingRole} onClose={handleClose} />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this custom role and remove any
              permission assignments. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
