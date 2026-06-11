"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { setSalonModules } from "@/lib/actions/modules";
import type { SalonModuleState } from "@/lib/modules";

interface SalonModuleTogglesProps {
  salonId: string;
  initial: SalonModuleState[];
  /** When true (inactive salon), toggles are read-only. */
  disabled?: boolean;
}

export function SalonModuleToggles({ salonId, initial, disabled = false }: SalonModuleTogglesProps) {
  const [states, setStates] = useState<SalonModuleState[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggle(key: string, enabled: boolean) {
    setStates((prev) => prev.map((s) => (s.key === key ? { ...s, enabled } : s)));
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      try {
        const disabledKeys = states.filter((s) => !s.enabled).map((s) => s.key);
        const res = await setSalonModules(salonId, disabledKeys);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Module settings saved");
        setDirty(false);
      } catch (error) {
        console.error("Failed to save module settings:", error);
        toast.error("Failed to save module settings. Please try again.");
      }
    });
  }

  const enabledCount = states.filter((s) => s.enabled).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {enabledCount} of {states.length} modules enabled. Disabled modules are hidden from this
        salon&apos;s users. Dashboard and Settings are always available.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {states.map((m) => (
          <label
            key={m.key}
            className="flex items-center justify-between gap-3 rounded-lg border p-3 cursor-pointer"
          >
            <span className="text-sm font-medium">{m.label}</span>
            <Switch
              checked={m.enabled}
              disabled={disabled || isPending}
              onCheckedChange={(v) => toggle(m.key, v)}
              aria-label={`Toggle ${m.label}`}
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || isPending || disabled}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        {dirty && !isPending && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
