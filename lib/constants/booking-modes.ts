// The two modes the "New booking" screen can open in, driven by the salon's default setting and
// the Walk-in / Appointment toggle:
//   WALK_IN     → "Walk-in (here now)"     — check the client in immediately, at the current time
//   APPOINTMENT → "Appointment (for later)" — schedule for a future date/time
// Single source of truth for both the TypeScript type and runtime validation.
export const BOOKING_MODES = ["WALK_IN", "APPOINTMENT"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const BOOKING_MODE_LABELS: Record<BookingMode, string> = {
  WALK_IN: "Walk-in — here now",
  APPOINTMENT: "Appointment — for later",
};
