"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { createRole, updateRole, type RoleInfo } from "@/lib/actions/role";

interface RoleFormProps {
  role?: RoleInfo;
  onClose: () => void;
}

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E",
  "#14B8A6", "#3B82F6", "#6366F1", "#8B5CF6",
  "#A855F7", "#EC4899", "#F43F5E", "#6B7280",
];

export function RoleForm({ role, onClose }: RoleFormProps) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [color, setColor] = useState(role?.color ?? "#6B7280");
  const [hierarchyLevel, setHierarchyLevel] = useState(role?.hierarchyLevel ?? 30);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (isEdit) {
        const result = await updateRole({
          id: role.id,
          name,
          description,
          color,
          hierarchyLevel,
        });
        if (result.success) {
          toast.success("Role updated successfully");
          window.location.reload();
        } else {
          toast.error(result.error);
        }
      } else {
        const result = await createRole({
          name,
          label: name,
          description,
          color,
          hierarchyLevel,
        });
        if (result.success) {
          toast.success("Role created successfully");
          window.location.reload();
        } else {
          toast.error(result.error);
        }
      }
    } catch {
      toast.error("An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getHierarchyDescription = () => {
    if (hierarchyLevel >= 75) return "Near Admin level";
    if (hierarchyLevel >= 50) return "Near Staff level";
    if (hierarchyLevel >= 25) return "Near Receptionist level";
    return "Below Receptionist";
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Role Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Senior Stylist, Branch Manager"
          required
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers, spaces, underscores, and hyphens only. No other special characters.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this role's purpose"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="custom-role-color">Color</Label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`h-8 w-8 rounded-full border-2 transition-all ${
                color === c ? "border-foreground scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={`Select color ${c}`}
            />
          ))}
          <Input
            id="custom-role-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-8 p-0 border-0 cursor-pointer"
            aria-label="Pick a custom color"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Hierarchy Level</Label>
          <span className="text-sm font-medium">{hierarchyLevel}</span>
        </div>
        <Slider
          value={[hierarchyLevel]}
          onValueChange={(v: number[]) => setHierarchyLevel(v[0])}
          min={1}
          max={99}
          step={1}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 (lowest)</span>
          <span>REC: 25</span>
          <span>STAFF: 50</span>
          <span>ADMIN: 75</span>
          <span>99 (highest)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {getHierarchyDescription()}. Higher levels can manage lower levels.
          Must be below OWNER (100).
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Update Role" : "Create Role"}
        </Button>
      </div>
    </form>
  );
}
