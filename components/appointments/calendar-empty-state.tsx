"use client";

import { Calendar as CalendarIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Empty state shown over the calendar/lane grid when a period has no appointments.
 * The wrapper is click-through (pointer-events-none) so the grid slots underneath stay
 * bookable; only the card itself captures clicks (its "Book Appointment" button).
 */
export function CalendarEmptyState({
  span,
  onBook,
  onToday,
}: {
  span: "day" | "week" | "month";
  onBook?: () => void;
  onToday?: () => void;
}) {
  const label = span; // already "day" | "week" | "month"
  // Month is a fixed-height grid that fully fits on screen, so center the card for balance. Day/Week
  // are tall and scrollable, so anchor near the top to guarantee it's visible without scrolling.
  const isMonth = span === "month";
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 flex justify-center ${
        isMonth ? "items-center" : "items-start"
      }`}
    >
      {/* The card is click-through (pointer-events-none) so a click on its background/icon/text
          falls to the grid slot underneath and books that time. Only the buttons capture clicks. */}
      <div
        className={`pointer-events-none w-[min(20rem,90%)] rounded-xl border bg-background p-6 text-center shadow-lg ${
          isMonth ? "" : "mt-20"
        }`}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarIcon className="h-6 w-6" />
        </div>
        <p className="mt-3 font-semibold text-foreground">No appointments this {label}</p>
        <p className="mt-1 text-sm text-muted-foreground">Nothing booked yet.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {onBook && (
            <Button size="sm" onClick={onBook} className="pointer-events-auto">
              <Plus className="h-4 w-4" />
              Book Appointment
            </Button>
          )}
          {onToday && (
            <button
              type="button"
              onClick={onToday}
              className="pointer-events-auto text-sm font-medium text-primary hover:underline"
            >
              Jump to today <span aria-hidden>→</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
