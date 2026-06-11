"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setSalonMaxStaff } from "@/lib/actions/salon";

interface SalonStaffLimitProps {
  salonId: string;
  /** Current org seat limit (null = unlimited). */
  initialLimit: number | null;
  /** Current distinct active staff used org-wide. */
  used: number;
}

export function SalonStaffLimit({ salonId, initialLimit, used }: SalonStaffLimitProps) {
  // Empty string = unlimited.
  const [value, setValue] = useState<string>(initialLimit != null ? String(initialLimit) : "");
  const [savedLimit, setSavedLimit] = useState<number | null>(initialLimit);
  const [isPending, startTransition] = useTransition();

  const parsed = value.trim() === "" ? null : Number(value);
  const invalid = parsed != null && (!Number.isInteger(parsed) || parsed < 1);
  const dirty = (parsed ?? null) !== (savedLimit ?? null);

  function save() {
    if (invalid) return;
    startTransition(async () => {
      try {
        const res = await setSalonMaxStaff(salonId, parsed);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        setSavedLimit(res.data.maxStaff);
        setValue(res.data.maxStaff != null ? String(res.data.maxStaff) : "");
        toast.success("Staff limit updated");
      } catch (error) {
        console.error("Failed to update staff limit:", error);
        toast.error("Failed to update staff limit. Please try again.");
      }
    });
  }

  const overLimit = savedLimit != null && used > savedLimit;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Maximum staff for the whole organization (main salon + all branches). Leave blank for
        unlimited. A person in multiple branches counts once.
      </p>

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="maxStaff" className="text-xs font-medium text-muted-foreground">
            Staff limit
          </label>
          <Input
            id="maxStaff"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Unlimited"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isPending}
            className="w-40"
          />
        </div>
        <Button onClick={save} disabled={!dirty || invalid || isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {invalid && <p className="text-xs text-destructive">Enter a positive number, or leave blank for unlimited.</p>}

      <p className="text-sm">
        <span className="font-medium">{used}</span>
        {savedLimit != null ? (
          <>
            {" "}
            of <span className="font-medium">{savedLimit}</span> seats used
            {overLimit && (
              <span className="ml-2 text-destructive">
                (over limit — existing staff are kept, but no new staff can be added)
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground"> staff (unlimited)</span>
        )}
      </p>
    </div>
  );
}
