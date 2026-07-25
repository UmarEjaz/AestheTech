/**
 * An appointment's "primary provider" is simply its first service (order 0). Services are always
 * stored/loaded ordered by `order`, so `services[0]` is the primary. There is no denormalized
 * `appointment.staffId` — the per-service assignment is the single source of truth.
 *
 * Callers must pass a services array that was ordered by `order` (all app queries do).
 */
export function primaryStaff<T>(services: { staff: T }[]): T {
  return services[0].staff;
}

export function primaryStaffId(services: { staffId: string }[]): string {
  return services[0].staffId;
}
