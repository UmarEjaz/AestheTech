import { cn } from "@/lib/utils";

/**
 * Shared styling for the pick-one "chip" buttons used by the recurrence pattern
 * and series-ends selectors. Kept in one place so both selectors stay in sync.
 */
export function chipClass(active: boolean) {
  return cn(
    "flex-[1_1_auto] whitespace-nowrap rounded-lg border px-3 py-2 text-center text-[13px] font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-input bg-background hover:border-primary/40 hover:bg-accent"
  );
}
