"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, Scissors } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { userSchema, UserFormData, UserFormInput, UserUpdateData } from "@/lib/validations/user";
import { createUser, updateUser } from "@/lib/actions/user";
import { useRoles } from "@/lib/roles-context";
import { SYSTEM_ROLES, SYSTEM_ROLE_HIERARCHY } from "@/lib/roles";

interface StaffFormProps {
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string;                      // slug (for display fallback)
    roleDefinitionId?: string | null;  // the role's id at this salon
    isActive: boolean;
    isServiceProvider: boolean;
  };
  mode: "create" | "edit";
  currentUserRole: string | null;
  isSuperAdmin?: boolean;
  /** True when the logged-in user is editing their own profile. */
  isSelf?: boolean;
}

export function StaffForm({ user, mode, currentUserRole, isSuperAdmin = false, isSelf = false }: StaffFormProps) {
  const router = useRouter();
  const roles = useRoles();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Roles are identified by their RoleDefinition id. On edit, preselect the
  // user's current role; on create, default to the Staff role.
  const initialRoleId =
    user?.roleDefinitionId ??
    roles.find((r) => r.slug === SYSTEM_ROLES.STAFF)?.id ??
    "";
  const [selectedRole, setSelectedRole] = useState<string>(initialRoleId);
  const [isServiceProvider, setIsServiceProvider] = useState(user?.isServiceProvider ?? false);

  // Filter available roles based on current user's role hierarchy
  const getAvailableRoles = () => {
    // Super admins can assign any role
    if (isSuperAdmin) return roles;
    if (!currentUserRole) return [];

    const currentLevel = roles.find((r) => r.slug === currentUserRole)?.hierarchyLevel
      ?? SYSTEM_ROLE_HIERARCHY[currentUserRole] ?? 0;

    const assignable = roles.filter((r) => currentLevel > r.hierarchyLevel);

    // When editing someone else, always include their CURRENT role so it shows
    // (and isn't lost on save) even if it's at/above your level. You still can't
    // assign a higher role — canManageRole enforces that server-side.
    if (mode === "edit" && user?.roleDefinitionId) {
      const current = roles.find((r) => r.id === user.roleDefinitionId);
      if (current && !assignable.some((r) => r.id === current.id)) {
        return [current, ...assignable];
      }
    }
    return assignable;
  };

  const availableRoles = getAvailableRoles();

  const targetIsOwner = (user?.role ?? "") === SYSTEM_ROLES.OWNER;
  // Role is read-only for your own profile, and for the owner (ownership isn't
  // reassignable through this form).
  const roleLocked = isSelf || targetIsOwner;
  // Only the owner (or a super admin) may change the service-provider flag on
  // their OWN profile; any other staff member must ask the owner.
  const canToggleServiceProvider = !isSelf || isSuperAdmin || currentUserRole === SYSTEM_ROLES.OWNER;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UserFormInput, unknown, UserFormData>({
    resolver: mode === "create" ? zodResolver(userSchema) : undefined,
    defaultValues: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: user?.email || "",
      phone: user?.phone || "",
      role: initialRoleId,
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: UserFormData) => {
    setIsSubmitting(true);

    try {
      const formData = { ...data, role: selectedRole, isServiceProvider };

      if (mode === "create") {
        const result = await createUser(formData);
        if (result.success) {
          toast.success("Staff member created successfully");
          router.push(`/dashboard/staff/${result.data.id}`);
        } else {
          toast.error(result.error);
        }
      } else if (user) {
        const updateData: UserUpdateData = {
          id: user.id,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          role: selectedRole,
          isServiceProvider,
        };
        const result = await updateUser(updateData);
        if (result.success) {
          toast.success("Staff member updated successfully");
          router.push(`/dashboard/staff/${user.id}`);
        } else {
          toast.error(result.error);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Enter the staff member&apos;s personal details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                {...register("firstName")}
                placeholder="John"
              />
              {errors.firstName && (
                <p className="text-sm text-destructive">{errors.firstName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                {...register("lastName")}
                placeholder="Doe"
              />
              {errors.lastName && (
                <p className="text-sm text-destructive">{errors.lastName.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                placeholder="john@example.com"
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                {...register("phone")}
                placeholder="+1 (555) 123-4567"
              />
              {errors.phone && (
                <p className="text-sm text-destructive">{errors.phone.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role & Permissions</CardTitle>
          <CardDescription>
            Assign a role to determine what this staff member can access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role">Role *</Label>
            {roleLocked ? (
              <>
                <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
                  {roles.find((r) => r.id === selectedRole)?.name ?? user?.role ?? "—"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {targetIsOwner
                    ? "The owner's role can't be changed."
                    : "You can't change your own role — ask your owner or an admin to change it for you."}
                </p>
              </>
            ) : (
              <>
                <Select
                  value={selectedRole}
                  onValueChange={(value) => setSelectedRole(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        <div className="flex flex-col">
                          <span>{role.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableRoles.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    You can only assign roles lower than your own.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="isServiceProvider" className="font-medium">Service Provider</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Enable if this person provides services to clients (e.g., haircuts, makeup). They will appear in the appointment booking dropdown.
              </p>
            </div>
            {canToggleServiceProvider ? (
              <Switch
                id="isServiceProvider"
                checked={isServiceProvider}
                onCheckedChange={setIsServiceProvider}
              />
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* span wrapper so the tooltip still fires on a disabled control */}
                    <span tabIndex={0}>
                      <Switch
                        id="isServiceProvider"
                        checked={isServiceProvider}
                        disabled
                        aria-disabled
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    You can&apos;t change your own service-provider status — ask the salon owner or an admin to update it for you.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>Account Security</CardTitle>
            <CardDescription>
              Set a password for the staff member to login
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...register("password")}
                    placeholder="Enter password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters with uppercase, lowercase, and number
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password *</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    {...register("confirmPassword")}
                    placeholder="Confirm password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || availableRoles.length === 0}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create Staff Member" : "Update Staff Member"}
        </Button>
      </div>
    </form>
  );
}
