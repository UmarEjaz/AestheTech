"use server";

import { revalidatePath } from "next/cache";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { runSerializable } from "@/lib/db-retry";
import { assertPaymentOwner } from "@/lib/payment-guards";
import { primaryStaffId } from "@/lib/utils/appointment";
import { checkAuth } from "@/lib/auth-helpers";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils/currency";
import {
  appointmentSchema,
  appointmentStatusSchema,
  rescheduleSchema,
  availableSlotsSchema,
  validateCustomTimeSchema,
  calendarQuerySchema,
  appointmentDepositSchema,
  AppointmentFormData,
  AppointmentStatusFormData,
  RescheduleFormData,
} from "@/lib/validations/appointment";
import { Prisma, AppointmentStatus, PaymentMethod } from "@prisma/client";
import { logAudit } from "./audit";
import { getSettings } from "./settings";
import { ActionResult } from "@/lib/types";
import { invalidateDashboardCache } from "@/lib/redis";
import { getOrganizationSalonIds } from "./branch";

// Include relations for appointment list
const appointmentListInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      isWalkIn: true,
      // Loyalty comes WITH the appointment so checkout never has to look the client up in a
      // separate (capped) list — the appointment fetch is the authoritative source.
      loyaltyPoints: true,
    },
  },
  // All services (1..N), each with its own staff + price/duration snapshot. order 0 = primary
  // provider (the source of truth — there is no denormalized appointment.staff to keep in sync).
  services: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      price: true,
      duration: true,
      service: { select: { id: true, name: true, points: true, category: { select: { id: true, name: true } } } },
      staff: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  series: {
    select: {
      id: true,
      pattern: true,
      customWeeks: true,
      isActive: true,
    },
  },
  // Deposits/prepayments taken against this appointment (applied at checkout).
  payments: {
    select: { id: true, amount: true, method: true, paidAt: true },
    orderBy: { paidAt: "asc" },
  },
  // The sale this appointment was checked out into (null until checked out).
  sale: { select: { id: true } },
});

type RawAppointment = Prisma.AppointmentGetPayload<{
  include: typeof appointmentListInclude;
}>;

// Client components can't receive Prisma Decimal instances across the server→client boundary, so
// the money fields are exposed as plain numbers. `serializeAppointment` converts them before an
// appointment leaves any server action / page loader.
export type AppointmentListItem = Omit<RawAppointment, "services" | "payments"> & {
  services: (Omit<RawAppointment["services"][number], "price"> & { price: number })[];
  payments: (Omit<RawAppointment["payments"][number], "amount"> & { amount: number })[];
};

function serializeAppointment(a: RawAppointment): AppointmentListItem {
  return {
    ...a,
    services: a.services.map((s) => ({ ...s, price: Number(s.price) })),
    payments: a.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

// Get appointments with filters
export async function getAppointments(params: {
  date?: Date;
  startDate?: Date;
  endDate?: Date;
  staffId?: string;
  clientId?: string;
  status?: AppointmentStatus;
  page?: number;
  limit?: number;
} = {}): Promise<ActionResult<{
  appointments: AppointmentListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const { date, startDate, endDate, staffId, clientId, status, page = 1, limit = 50 } = params;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50;
  const skip = (safePage - 1) * safeLimit;

  // Build date filter
  let dateFilter: Prisma.DateTimeFilter | undefined;

  if (date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    dateFilter = { gte: dayStart, lte: dayEnd };
  } else if (startDate || endDate) {
    dateFilter = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;
  }

  const where: Prisma.AppointmentWhereInput = {
    salonId: authResult.salonId,
    ...(dateFilter && { startTime: dateFilter }),
    // Filter by any appointment where this staff member performs a service (primary or secondary).
    ...(staffId && { services: { some: { staffId } } }),
    ...(clientId && { clientId }),
    ...(status && { status }),
  };

  try {
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: appointmentListInclude,
        orderBy: { startTime: "asc" },
        skip,
        take: safeLimit,
      }),
      prisma.appointment.count({ where }),
    ]);

    return {
      success: true,
      data: {
        appointments: appointments.map(serializeAppointment),
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  } catch (error) {
    console.error("Error fetching appointments:", error);
    return { success: false, error: "Failed to fetch appointments" };
  }
}

// Get single appointment
export async function getAppointment(id: string): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      include: appointmentListInclude,
    });

    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }

    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    console.error("Error fetching appointment:", error);
    return { success: false, error: "Failed to fetch appointment" };
  }
}

// A service segment: one provider is busy for a specific slice of the appointment.
type Segment = { staffId: string; startMs: number; endMs: number };

// Compute per-service segments from ORDERED (staffId, duration) lines starting at startMs.
// Service i occupies [start + Σd[0..i-1], + d[i]) — so each provider is only busy for the slice
// they actually work, not the whole appointment.
function computeSegments(startMs: number, lines: { staffId: string; duration: number }[]): Segment[] {
  const segs: Segment[] = [];
  let offsetMs = 0;
  for (const line of lines) {
    const s = startMs + offsetMs;
    const e = s + line.duration * 60_000;
    segs.push({ staffId: line.staffId, startMs: s, endMs: e });
    offsetMs += line.duration * 60_000;
  }
  return segs;
}

// True if any provider in `segments` is already booked during their slice by another appointment.
// Each provider is checked ONLY for the time they actually work, compared against the other
// appointments' per-service segments — so multi-provider bookings never over-reserve, and no
// secondary provider is missed (which single-provider checks used to allow).
// `db` may be the base client or a transaction client — booking paths run this INSIDE a
// serializable transaction (with the write) so the check and write can't interleave.
async function hasSegmentConflict(
  db: Prisma.TransactionClient,
  salonId: string,
  segments: Segment[],
  excludeId?: string
): Promise<boolean> {
  if (segments.length === 0) return false;
  const staffIds = Array.from(new Set(segments.map((s) => s.staffId)));
  const windowStart = Math.min(...segments.map((s) => s.startMs));
  const windowEnd = Math.max(...segments.map((s) => s.endMs));

  const candidates = await db.appointment.findMany({
    where: {
      salonId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      services: { some: { staffId: { in: staffIds } } },
      startTime: { lt: new Date(windowEnd) },
      endTime: { gt: new Date(windowStart) },
    },
    select: {
      startTime: true,
      services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
    },
  });

  for (const c of candidates) {
    const otherSegs = computeSegments(c.startTime.getTime(), c.services);
    for (const a of segments) {
      for (const b of otherSegs) {
        // Same provider AND overlapping time slice → real conflict.
        if (a.staffId === b.staffId && a.startMs < b.endMs && a.endMs > b.startMs) {
          return true;
        }
      }
    }
  }
  return false;
}

// True when a write was rejected by the `no_provider_overlap` exclusion constraint — i.e. the DB
// caught a double-booking (the storage-level backstop behind the hasSegmentConflict pre-check).
function isOverlapConstraintError(error: unknown): boolean {
  // Match the constraint name / SQLSTATE 23P01 (exclusion_violation) specifically. NOT the generic
  // Prisma P2004 ("a constraint failed") — other CHECKs (e.g. payment_owner_required) share it and
  // must not be mistaken for a scheduling conflict.
  return error instanceof Error && /no_provider_overlap|23P01/i.test(error.message);
}

type ResolvedService = { id: string; duration: number; price: Prisma.Decimal; isActive: boolean };

// Validate all services on an appointment and compute the total duration.
// Returns a map (serviceId -> row) so callers can snapshot price/duration per line.
async function resolveServices(
  services: { serviceId: string; staffId: string }[],
  orgSalonIds: string[]
): Promise<
  | { ok: true; totalDuration: number; serviceMap: Map<string, ResolvedService> }
  | { ok: false; error: string }
> {
  const ids = services.map((s) => s.serviceId);
  const rows = await prisma.service.findMany({
    where: { id: { in: ids }, salonId: { in: orgSalonIds } },
    select: { id: true, duration: true, price: true, isActive: true },
  });
  const serviceMap = new Map<string, ResolvedService>(rows.map((s) => [s.id, s]));

  let totalDuration = 0;
  for (const s of services) {
    const row = serviceMap.get(s.serviceId);
    if (!row) return { ok: false, error: "A selected service was not found" };
    if (!row.isActive) return { ok: false, error: "A selected service is not available" };
    totalDuration += row.duration;
  }

  return { ok: true, totalDuration, serviceMap };
}

// Verify every staff id is assigned to the branch, active, and a service provider.
async function verifyStaffProviders(
  staffIds: string[],
  salonId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = await prisma.userSalon.findMany({
    where: {
      userId: { in: staffIds },
      salonId,
      isActive: true,
      user: { isActive: true, isServiceProvider: true },
    },
    select: { userId: true },
  });
  const validIds = new Set(valid.map((v) => v.userId));
  for (const sid of staffIds) {
    if (!validIds.has(sid)) {
      return { ok: false, error: "Staff member not found, inactive, or not a service provider in this branch" };
    }
  }
  return { ok: true };
}

// Create appointment
export async function createAppointment(
  data: AppointmentFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { clientId, services, startTime, notes } = validationResult.data;
  // Primary provider = the first service's staff (denormalized onto the appointment).
  const primaryStaff = services[0].staffId;

  try {
    // Get org salon IDs to validate cross-branch references within the organization
    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    // Resolve every service for duration/price and validity
    const serviceResolution = await resolveServices(services, orgSalonIds);
    if (!serviceResolution.ok) {
      return { success: false, error: serviceResolution.error };
    }
    const { totalDuration, serviceMap } = serviceResolution;

    // Calculate end time from the total duration across all services
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Each provider must be free during the slice they actually work (per-service segments) —
    // so a multi-provider booking neither over-reserves nor lets a secondary provider double-book.
    const segments = computeSegments(
      startTime.getTime(),
      services.map((s) => ({ staffId: s.staffId, duration: serviceMap.get(s.serviceId)!.duration }))
    );
    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));

    // Verify client exists and is active (org-scoped)
    const client = await prisma.client.findFirst({
      where: { id: clientId, salonId: { in: orgSalonIds } },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Verify EVERY involved staff member is assigned to this branch, active, and a service
    // provider. Defense-in-depth — the dropdowns filter, but a scripted client could submit anything.
    const staffCheck = await verifyStaffProviders(distinctStaffIds, authResult.salonId);
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }

    // Conflict check + write in ONE serializable transaction (with retry) so two concurrent
    // bookings can't both pass the check. The DB exclusion constraint is the final backstop; this
    // makes the friendly pre-check race-proof too.
    const outcome = await runSerializable(async (tx) => {
      if (await hasSegmentConflict(tx, authResult.salonId, segments)) {
        return { ok: false as const };
      }
      const appt = await tx.appointment.create({
        data: {
          salonId: authResult.salonId,
          clientId,
          startTime,
          endTime,
          notes: notes || null,
          status: "SCHEDULED",
          services: {
            create: services.map((s, i) => {
              const row = serviceMap.get(s.serviceId)!;
              return {
                salonId: authResult.salonId,
                serviceId: s.serviceId,
                staffId: s.staffId,
                price: row.price,
                duration: row.duration,
                order: i,
                // Persist the busy window so the DB exclusion constraint can enforce no overlap.
                segmentStart: new Date(segments[i].startMs),
                segmentEnd: new Date(segments[i].endMs),
                active: true,
              };
            }),
          },
        },
        include: appointmentListInclude,
      });
      return { ok: true as const, appt };
    });
    if (!outcome.ok) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    const appointment = outcome.appt;

    await logAudit({
      action: "APPOINTMENT_CREATED",
      entityType: "Appointment",
      entityId: appointment.id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId, staffId: primaryStaff, startTime: startTime.toISOString(), services: services.length },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    console.error("Error creating appointment:", error);
    return { success: false, error: "Failed to create appointment" };
  }
}

// Update appointment
export async function updateAppointment(
  id: string,
  data: AppointmentFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { clientId, services, startTime, notes } = validationResult.data;
  const primaryStaff = services[0].staffId;

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot update completed or cancelled appointments" };
    }

    const orgSalonIds = await getOrganizationSalonIds(authResult.salonId);

    // Resolve every service for duration/price and validity
    const serviceResolution = await resolveServices(services, orgSalonIds);
    if (!serviceResolution.ok) {
      return { success: false, error: serviceResolution.error };
    }
    const { totalDuration, serviceMap } = serviceResolution;

    // Calculate end time from the total duration across all services
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Verify client exists and is active (org-scoped)
    const client = await prisma.client.findFirst({
      where: { id: clientId, salonId: { in: orgSalonIds } },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Each provider must be free during their own service slice (excluding this appointment).
    const segments = computeSegments(
      startTime.getTime(),
      services.map((s) => ({ staffId: s.staffId, duration: serviceMap.get(s.serviceId)!.duration }))
    );
    const distinctStaffIds = Array.from(new Set(services.map((s) => s.staffId)));
    const staffCheck = await verifyStaffProviders(distinctStaffIds, authResult.salonId);
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }

    // Conflict check + write in one serializable transaction (with retry) + DB constraint backstop.
    const outcome = await runSerializable(async (tx) => {
      if (await hasSegmentConflict(tx, authResult.salonId, segments, id)) {
        return { ok: false as const };
      }
      const appt = await tx.appointment.update({
        where: { id },
        data: {
          clientId,
          startTime,
          endTime,
          notes: notes || null,
          // Replace the whole service set
          services: {
            deleteMany: {},
            create: services.map((s, i) => {
              const row = serviceMap.get(s.serviceId)!;
              return {
                salonId: authResult.salonId,
                serviceId: s.serviceId,
                staffId: s.staffId,
                price: row.price,
                duration: row.duration,
                order: i,
                // Refresh the busy window so the DB exclusion constraint stays accurate.
                segmentStart: new Date(segments[i].startMs),
                segmentEnd: new Date(segments[i].endMs),
                active: true,
              };
            }),
          },
        },
        include: appointmentListInclude,
      });
      return { ok: true as const, appt };
    });
    if (!outcome.ok) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    const appointment = outcome.appt;

    await logAudit({
      action: "APPOINTMENT_UPDATED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId, staffId: primaryStaff, startTime: startTime.toISOString(), services: services.length },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    console.error("Error updating appointment:", error);
    return { success: false, error: "Failed to update appointment" };
  }
}

// Update appointment status
export async function updateAppointmentStatus(
  id: string,
  data: AppointmentStatusFormData
): Promise<ActionResult<AppointmentListItem>> {
  // Cancellation requires the dedicated cancel permission
  const requiredPermission = data.status === "CANCELLED" ? "appointments:cancel" : "appointments:update";
  const authResult = await checkAuth(requiredPermission);
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = appointmentStatusSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: {
        status: true,
        startTime: true,
        endTime: true,
        services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    // Validate status transitions. NO_SHOW/CANCELLED can be reactivated back to
    // SCHEDULED ("undo no-show" / "reopen") so a late or returning client can still
    // be served and checked out.
    const validTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
      SCHEDULED: ["CONFIRMED", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
      COMPLETED: [],
      CANCELLED: ["SCHEDULED"],
      NO_SHOW: ["SCHEDULED"],
    };

    const allowedNextStatuses = validTransitions[existing.status];
    if (!allowedNextStatuses.includes(validationResult.data.status)) {
      return {
        success: false,
        error: `Cannot change status from ${existing.status} to ${validationResult.data.status}`,
      };
    }

    // Reactivating a NO_SHOW/CANCELLED appointment: make sure the slot is still free
    // (it may have been given to someone else in the meantime).
    const isReactivation =
      (existing.status === "NO_SHOW" || existing.status === "CANCELLED") &&
      validationResult.data.status === "SCHEDULED";
    // Cancelled/no-show rows free the provider's slot (active=false); any other status keeps it
    // reserved.
    const rowsActive =
      validationResult.data.status !== "CANCELLED" && validationResult.data.status !== "NO_SHOW";

    // Reactivation must re-check availability; run that check + the status write in one serializable
    // transaction (with retry). Flipping rows back to active also hits the DB exclusion constraint
    // as the final backstop.
    const outcome = await runSerializable(async (tx) => {
      if (
        isReactivation &&
        (await hasSegmentConflict(
          tx,
          authResult.salonId,
          computeSegments(existing.startTime.getTime(), existing.services),
          id
        ))
      ) {
        return { ok: false as const };
      }
      const appt = await tx.appointment.update({
        where: { id },
        data: {
          status: validationResult.data.status,
          services: { updateMany: { where: {}, data: { active: rowsActive } } },
        },
        include: appointmentListInclude,
      });
      return { ok: true as const, appt };
    });
    if (!outcome.ok) {
      return {
        success: false,
        error: "That time slot is no longer free — reschedule the appointment to reactivate it.",
      };
    }
    const appointment = outcome.appt;

    await logAudit({
      action: "APPOINTMENT_STATUS_CHANGED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { from: existing.status, to: validationResult.data.status },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return {
        success: false,
        error: "That time slot is no longer free — reschedule the appointment to reactivate it.",
      };
    }
    console.error("Error updating appointment status:", error);
    return { success: false, error: "Failed to update appointment status" };
  }
}

// Reschedule appointment
export async function rescheduleAppointment(
  id: string,
  data: RescheduleFormData
): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = rescheduleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { startTime, staffId: newStaffId } = validationResult.data;

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      include: { services: { orderBy: { order: "asc" }, select: { id: true, duration: true, order: true, staffId: true } } },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return { success: false, error: "Cannot reschedule completed or cancelled appointments" };
    }

    // Every appointment should have at least one service; guard defensively so deriving the
    // primary provider from services[0] can never throw (e.g. legacy rows from a schema change).
    if (existing.services.length === 0) {
      return { success: false, error: "This appointment has no services to reschedule." };
    }

    // The primary provider = the first service's staff. A crafted newStaffId could reassign the
    // appointment to an inactive, non-provider, or cross-branch user — verify before applying.
    const currentPrimary = primaryStaffId(existing.services);
    if (newStaffId && newStaffId !== currentPrimary) {
      const staffCheck = await verifyStaffProviders([newStaffId], authResult.salonId);
      if (!staffCheck.ok) {
        return { success: false, error: staffCheck.error };
      }
    }

    const staffId = newStaffId || currentPrimary;

    // End time spans the total duration of all services
    const totalDuration = existing.services.reduce((sum, s) => sum + s.duration, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Each provider must be free during their own service slice at the new time (this appointment
    // excluded). If the primary provider changed, its first service moves to the new staff.
    const rescheduleLines = existing.services.map((s, i) => ({
      staffId: i === 0 ? staffId : s.staffId,
      duration: s.duration,
    }));
    const rescheduleSegments = computeSegments(startTime.getTime(), rescheduleLines);

    // Conflict check + write in one serializable transaction (with retry) + DB constraint backstop.
    // The time changed, so refresh every service row's busy window (and move the primary line to the
    // new staff if it changed) to keep the constraint's data accurate.
    const outcome = await runSerializable(async (tx) => {
      if (await hasSegmentConflict(tx, authResult.salonId, rescheduleSegments, id)) {
        return { ok: false as const };
      }
      const appt = await tx.appointment.update({
        where: { id },
        data: {
          startTime,
          endTime,
          services: {
            update: existing.services.map((s, i) => ({
              where: { id: s.id },
              data: {
                segmentStart: new Date(rescheduleSegments[i].startMs),
                segmentEnd: new Date(rescheduleSegments[i].endMs),
                ...(i === 0 && staffId !== currentPrimary ? { staffId } : {}),
              },
            })),
          },
        },
        include: appointmentListInclude,
      });
      return { ok: true as const, appt };
    });
    if (!outcome.ok) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    const appointment = outcome.appt;

    await logAudit({
      action: "APPOINTMENT_RESCHEDULED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { newStartTime: startTime.toISOString(), staffId },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { success: false, error: "This time slot conflicts with another appointment" };
    }
    console.error("Error rescheduling appointment:", error);
    return { success: false, error: "Failed to reschedule appointment" };
  }
}

// Cancel appointment
export async function cancelAppointment(id: string): Promise<ActionResult<AppointmentListItem>> {
  const authResult = await checkAuth("appointments:cancel");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: { status: true },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    if (existing.status === "COMPLETED") {
      return { success: false, error: "Cannot cancel completed appointments" };
    }

    if (existing.status === "CANCELLED") {
      return { success: false, error: "Appointment is already cancelled" };
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      // Free the provider's slot: cancelled service rows drop out of the overlap constraint.
      data: { status: "CANCELLED", services: { updateMany: { where: {}, data: { active: false } } } },
      include: appointmentListInclude,
    });

    await logAudit({
      action: "APPOINTMENT_CANCELLED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: serializeAppointment(appointment) };
  } catch (error) {
    console.error("Error cancelling appointment:", error);
    return { success: false, error: "Failed to cancel appointment" };
  }
}

// Delete appointment (permanent - admin only)
export async function deleteAppointment(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("appointments:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Verify appointment belongs to this salon before deleting
    const existing = await prisma.appointment.findFirst({
      where: { id, salonId: authResult.salonId },
      select: {
        id: true,
        clientId: true,
        startTime: true,
        services: { orderBy: { order: "asc" }, select: { staffId: true } },
      },
    });

    if (!existing) {
      return { success: false, error: "Appointment not found" };
    }

    // Real money may be held against this appointment as an un-applied deposit. Permanently
    // deleting would erase that record with no refund or trace, so refuse — the owner must
    // Cancel the appointment instead (which keeps the record and prompts a refund). Deposits
    // already applied to an invoice are safe: they stay owned by the invoice (appointmentId
    // is cleared to null on delete), never orphaned.
    // Check the held-deposit guard and delete in one serializable transaction, so a deposit taken
    // in the gap between them can't slip past the guard and be orphaned by the delete.
    const deleteOutcome = await runSerializable(async (tx) => {
      const heldDeposit = await tx.payment.aggregate({
        where: { appointmentId: id, invoiceId: null },
        _sum: { amount: true },
      });
      if (Number(heldDeposit._sum.amount ?? 0) > 0) {
        return { ok: false as const };
      }
      await tx.appointment.delete({ where: { id } });
      return { ok: true as const };
    });
    if (!deleteOutcome.ok) {
      return {
        success: false,
        error: "This appointment has a held deposit. Cancel it and refund the deposit before deleting.",
      };
    }

    await logAudit({
      action: "APPOINTMENT_DELETED",
      entityType: "Appointment",
      entityId: id,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { clientId: existing.clientId, staffId: existing.services[0]?.staffId ?? null, startTime: existing.startTime },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting appointment:", error);
    return { success: false, error: "Failed to delete appointment" };
  }
}

// Get available time slots for an appointment on a given date. Takes the ordered service→staff
// assignments so slots are validated per-provider-per-segment (a slot is offered only when every
// provider is free during the exact slice they'd work), matching createAppointment.
// Shared booking setup for getAvailableSlots + validateCustomTime, so both use identical rules
// (durations, salon-tz business-hours window, booking interval, and existing bookings as segments).
// `anchor` is any instant whose salon-tz calendar day defines the window.
async function buildBookingContext(
  salonId: string,
  assignments: { serviceId: string; staffId: string }[],
  anchor: Date,
  excludeAppointmentId?: string
): Promise<
  | {
      ok: true;
      lines: { staffId: string; duration: number }[];
      totalDuration: number;
      tz: string;
      slotInterval: number;
      dayStart: TZDate;
      dayEnd: TZDate;
      existingSegments: ReturnType<typeof computeSegments>;
    }
  | { ok: false; error: string }
> {
  const allStaffIds = Array.from(new Set(assignments.map((a) => a.staffId)));

  // Resolve durations (org-scoped) and read settings CONCURRENTLY — settings don't depend on the
  // org/service lookup, and this runs on every debounced keystroke, so avoid serial round trips.
  // resolveServices owns the "found + active" rule (used by createAppointment too), so availability
  // and booking stay in lockstep — no second copy of the rule to drift. Settings don't depend on it,
  // so both run concurrently (this runs on every debounced keystroke — avoid serial round trips).
  const [serviceResolution, settingsResult] = await Promise.all([
    getOrganizationSalonIds(salonId).then((orgSalonIds) => resolveServices(assignments, orgSalonIds)),
    getSettings(),
  ]);
  if (!serviceResolution.ok) {
    return { ok: false, error: serviceResolution.error };
  }
  const { totalDuration, serviceMap } = serviceResolution;
  const lines = assignments.map((a) => ({
    staffId: a.staffId,
    duration: serviceMap.get(a.serviceId)!.duration,
  }));

  // Business hours + booking interval from settings. A failed read must NOT silently fall back to
  // UTC/09:00–19:00 — that would report times outside the salon's real hours as bookable.
  if (!settingsResult.success) {
    return { ok: false, error: "Couldn't load salon settings" };
  }
  const settings = settingsResult.data;
  const tz = settings.timezone || "UTC";
  // Honor the salon's configured booking interval (default 30 min). Round to whole minutes and
  // clamp to the allowed 15–120 range so a bad stored value can't break the slot list.
  const slotInterval = Math.min(120, Math.max(15, Math.round(settings.appointmentInterval) || 30));

  const parseTime = (timeStr: string, defaultHour: number, defaultMin: number): [number, number] => {
    const parts = timeStr?.split(":");
    if (!parts || parts.length !== 2) return [defaultHour, defaultMin];
    const hour = parseInt(parts[0], 10);
    const min = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(min) || hour < 0 || hour > 23 || min < 0 || min > 59) {
      return [defaultHour, defaultMin];
    }
    return [hour, min];
  };
  const [startHour, startMin] = parseTime(settings.businessHoursStart, 9, 0);
  const [endHour, endMin] = parseTime(settings.businessHoursEnd, 19, 0);

  // Build the day's business-hours window in the SALON timezone from the anchor's calendar day.
  const dayInTz = new TZDate(anchor, tz);
  const y = dayInTz.getFullYear();
  const mo = dayInTz.getMonth();
  const dd = dayInTz.getDate();
  const dayStart = new TZDate(y, mo, dd, startHour, startMin, 0, 0, tz);
  const dayEnd = new TZDate(y, mo, dd, endHour, endMin, 0, 0, tz);

  // Existing appointments that day involving any of our providers, precomputed as provider segments.
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      salonId,
      services: { some: { staffId: { in: allStaffIds } } },
      startTime: { lt: new Date(dayEnd.getTime()) },
      endTime: { gt: new Date(dayStart.getTime()) },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
    },
    select: {
      startTime: true,
      services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
    },
  });
  const existingSegments = existingAppointments.flatMap((apt) =>
    computeSegments(apt.startTime.getTime(), apt.services)
  );

  return { ok: true, lines, totalDuration, tz, slotInterval, dayStart, dayEnd, existingSegments };
}

export async function getAvailableSlots(params: {
  assignments: { serviceId: string; staffId: string }[];
  date: Date;
  excludeAppointmentId?: string; // Exclude this appointment from conflict check (for edit mode)
}): Promise<ActionResult<{ startTime: Date; endTime: Date }[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validated = availableSlotsSchema.safeParse(params);
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message };
  }
  const { assignments, date, excludeAppointmentId } = validated.data;

  try {
    // Parity with validateCustomTime/createAppointment: an invalid staff id (another branch or an
    // inactive provider) must be rejected, not reported as fully available (it matches no existing
    // segment, so every slot would look free — and createAppointment would then refuse the booking).
    const staffCheck = await verifyStaffProviders(
      [...new Set(assignments.map((a) => a.staffId))],
      authResult.salonId
    );
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }
    const ctx = await buildBookingContext(authResult.salonId, assignments, date, excludeAppointmentId);
    if (!ctx.ok) {
      return { success: false, error: ctx.error };
    }
    const { lines, totalDuration, tz, slotInterval, dayStart, dayEnd, existingSegments } = ctx;
    const dayEndMs = dayEnd.getTime();

    // Calculate available slots
    const slots: { startTime: Date; endTime: Date }[] = [];
    const currentTime = new TZDate(dayStart.getTime(), tz);

    // Generate slots at the configured interval
    while (currentTime.getTime() < dayEndMs) {
      const slotStartMs = currentTime.getTime();
      const slotEndMs = slotStartMs + totalDuration * 60_000;

      // Check if slot fits within business hours
      if (slotEndMs <= dayEndMs) {
        // A slot is free only if EVERY provider is free during the exact slice they'd work.
        const slotSegs = computeSegments(slotStartMs, lines);
        const conflict = slotSegs.some((a) =>
          existingSegments.some(
            (b) => a.staffId === b.staffId && a.startMs < b.endMs && a.endMs > b.startMs
          )
        );
        if (!conflict) {
          slots.push({ startTime: new Date(slotStartMs), endTime: new Date(slotEndMs) });
        }
      }

      // Move to the next slot boundary (configured interval)
      currentTime.setMinutes(currentTime.getMinutes() + slotInterval);
    }

    return { success: true, data: slots };
  } catch (error) {
    console.error("Error getting available slots:", error);
    return { success: false, error: "Failed to get available slots" };
  }
}

// Validate a single typed custom start time using the SAME business-hours + conflict logic as
// getAvailableSlots. Returns a friendly reason so the booking form can warn inline instead of
// letting an invalid time reach the server and fail on submit.
export async function validateCustomTime(params: {
  assignments: { serviceId: string; staffId: string }[];
  startTime: Date;
  excludeAppointmentId?: string;
}): Promise<
  ActionResult<{
    ok: boolean;
    reason?: "past" | "outside-hours" | "conflict";
    openLabel?: string;
    closeLabel?: string;
    // Next bookable slot at/after the requested time (so the form can offer a one-tap fix). The
    // search rolls forward to later days when the requested day has no free slot left, so the
    // suggestion may fall on a different calendar day — suggestionDateISO carries that day (salon-tz
    // "yyyy-MM-dd") so the form can move to it, and suggestionLabel names the day when it differs.
    suggestionLabel?: string;
    suggestionHHMM?: string;
    suggestionDateISO?: string;
  }>
> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validated = validateCustomTimeSchema.safeParse(params);
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message };
  }
  const { assignments, startTime, excludeAppointmentId } = validated.data;

  try {
    // Verify every assigned provider is a real, active service provider in this branch (parity with
    // createAppointment/rescheduleAppointment) BEFORE the availability lookups, so an invalid staff id
    // is rejected without those queries.
    const staffCheck = await verifyStaffProviders(
      [...new Set(assignments.map((a) => a.staffId))],
      authResult.salonId
    );
    if (!staffCheck.ok) {
      return { success: false, error: staffCheck.error };
    }
    const ctx = await buildBookingContext(authResult.salonId, assignments, startTime, excludeAppointmentId);
    if (!ctx.ok) {
      return { success: false, error: ctx.error };
    }
    const { lines, totalDuration, tz, slotInterval, dayStart, dayEnd, existingSegments } = ctx;
    const startMs = startTime.getTime();
    const totalMs = totalDuration * 60_000;
    const endMs = startMs + totalMs;
    const now = Date.now();
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();
    // How far ahead the "next free slot" search will roll when the requested day is full/closed.
    const SUGGESTION_HORIZON_DAYS = 14;
    const allStaffIds = Array.from(new Set(lines.map((l) => l.staffId)));
    // The salon-local open/close wall-clock, reused to rebuild the window on later days.
    const openHour = dayStart.getHours();
    const openMin = dayStart.getMinutes();
    const closeHour = dayEnd.getHours();
    const closeMin = dayEnd.getMinutes();

    const clashesWith = (atMs: number, segs: typeof existingSegments): boolean => {
      const cand = computeSegments(atMs, lines);
      return cand.some((a) =>
        segs.some((b) => a.staffId === b.staffId && a.startMs < b.endMs && a.endMs > b.startMs)
      );
    };
    const hasClash = (atMs: number): boolean => clashesWith(atMs, existingSegments);

    // Scan ONE day's [open, close) window for the first non-past, conflict-free slot. Step a TZDate
    // from the day's open by the booking interval (like getAvailableSlots) so slots stay grid-aligned
    // and a DST day keeps wall-clock alignment. `floorMs` skips slots before the requested time.
    const scanDay = (
      openMs: number,
      closeMs: number,
      floorMs: number,
      segs: typeof existingSegments
    ): number | null => {
      const floor = Math.max(floorMs, now);
      const cursor = new TZDate(openMs, tz);
      while (cursor.getTime() < closeMs) {
        const t = cursor.getTime();
        cursor.setMinutes(cursor.getMinutes() + slotInterval);
        if (t < floor) continue;
        if (t + totalMs > closeMs) break;
        if (!clashesWith(t, segs)) return t;
      }
      return null;
    };

    // Existing bookings for the days AFTER the requested one, fetched once and only if needed.
    let futureSegments: typeof existingSegments | null = null;
    const dayWindow = (offset: number): { openMs: number; closeMs: number } => {
      const d = new TZDate(dayStartMs, tz);
      d.setDate(d.getDate() + offset);
      const y = d.getFullYear();
      const mo = d.getMonth();
      const dd = d.getDate();
      return {
        openMs: new TZDate(y, mo, dd, openHour, openMin, 0, 0, tz).getTime(),
        closeMs: new TZDate(y, mo, dd, closeHour, closeMin, 0, 0, tz).getTime(),
      };
    };
    const loadFutureSegments = async (): Promise<typeof existingSegments> => {
      if (futureSegments) return futureSegments;
      const rangeStart = dayWindow(1).openMs;
      const rangeEnd = dayWindow(SUGGESTION_HORIZON_DAYS).closeMs;
      const appts = await prisma.appointment.findMany({
        where: {
          salonId: authResult.salonId,
          services: { some: { staffId: { in: allStaffIds } } },
          startTime: { lt: new Date(rangeEnd) },
          endTime: { gt: new Date(rangeStart) },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
        },
        select: {
          startTime: true,
          services: { orderBy: { order: "asc" }, select: { staffId: true, duration: true } },
        },
      });
      futureSegments = appts.flatMap((apt) => computeSegments(apt.startTime.getTime(), apt.services));
      return futureSegments;
    };

    // First bookable slot at/after `fromMs` on the requested day, else rolling forward to later days.
    const findNextFree = async (fromMs: number): Promise<number | null> => {
      const sameDay = scanDay(dayStartMs, dayEndMs, fromMs, existingSegments);
      if (sameDay !== null) return sameDay;
      const future = await loadFutureSegments();
      for (let offset = 1; offset <= SUGGESTION_HORIZON_DAYS; offset++) {
        const { openMs, closeMs } = dayWindow(offset);
        const hit = scanDay(openMs, closeMs, openMs, future);
        if (hit !== null) return hit;
      }
      return null;
    };

    const requestedDayISO = format(dayStart, "yyyy-MM-dd");
    const suggest = (ms: number | null) => {
      if (ms === null) return {};
      const d = new TZDate(ms, tz);
      const mm = String(d.getMinutes()).padStart(2, "0");
      const iso = format(d, "yyyy-MM-dd");
      const timeLabel = format(d, mm === "00" ? "h a" : "h:mm a");
      return {
        suggestionHHMM: `${String(d.getHours()).padStart(2, "0")}:${mm}`,
        // Name the day only when the suggestion isn't on the requested day (avoids a misleading
        // bare "Use 9 AM" that would otherwise apply to the wrong date).
        suggestionLabel: iso === requestedDayISO ? timeLabel : `${format(d, "EEE MMM d")}, ${timeLabel}`,
        suggestionDateISO: iso,
      };
    };

    // 1) Past times can't be booked (only possible for today).
    if (startMs < now) {
      return { success: true, data: { ok: false, reason: "past", ...suggest(await findNextFree(now)) } };
    }

    // 2) Must sit fully inside the salon's business hours for that day.
    if (startMs < dayStartMs || endMs > dayEndMs) {
      return {
        success: true,
        data: {
          ok: false,
          reason: "outside-hours",
          openLabel: format(dayStart, "h:mm a"),
          closeLabel: format(dayEnd, "h:mm a"),
          ...suggest(await findNextFree(dayStartMs)),
        },
      };
    }

    // 3) No provider may already be booked during the slice they'd work.
    if (hasClash(startMs)) {
      return { success: true, data: { ok: false, reason: "conflict", ...suggest(await findNextFree(startMs)) } };
    }

    return { success: true, data: { ok: true } };
  } catch (error) {
    console.error("Error validating custom time:", error);
    return { success: false, error: "Failed to validate time" };
  }
}

// Get staff members who can perform appointments
export async function getStaffForAppointments(): Promise<ActionResult<{
  id: string;
  firstName: string;
  lastName: string;
}[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Resolve staff via branch membership (UserSalon). User.salonId is volatile (it's the
    // user's last-used branch) so it can't be used to determine who works at this branch.
    // Restricts to service providers — function is "for appointments" so non-providers
    // should never be returned.
    const staffRows = await prisma.userSalon.findMany({
      where: {
        salonId: authResult.salonId,
        isActive: true,
        user: { isActive: true, isServiceProvider: true },
      },
      select: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      distinct: ["userId"],
      orderBy: { user: { firstName: "asc" } },
    });
    const staff = staffRows.map((row) => row.user);

    return { success: true, data: staff };
  } catch (error) {
    console.error("Error fetching staff:", error);
    return { success: false, error: "Failed to fetch staff" };
  }
}

// Get appointments for calendar view (optimized for date range)
export async function getAppointmentsForCalendar(params: {
  startDate: Date;
  endDate: Date;
  staffId?: string;
  staffIds?: string[];
}): Promise<ActionResult<AppointmentListItem[]>> {
  const authResult = await checkAuth("appointments:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validated = calendarQuerySchema.safeParse(params);
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message };
  }
  const { startDate, endDate, staffId, staffIds } = validated.data;
  // Accept a single id (legacy) or a list; empty/omitted list means "all staff".
  const ids = staffIds && staffIds.length > 0 ? staffIds : staffId ? [staffId] : [];

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        salonId: authResult.salonId,
        startTime: { gte: startDate, lte: endDate },
        // Any appointment where one of these staff performs a service (primary or secondary).
        ...(ids.length > 0 && { services: { some: { staffId: { in: ids } } } }),
      },
      include: appointmentListInclude,
      orderBy: { startTime: "asc" },
    });

    return { success: true, data: appointments.map(serializeAppointment) };
  } catch (error) {
    console.error("Error fetching appointments for calendar:", error);
    return { success: false, error: "Failed to fetch appointments" };
  }
}

// ============================================
// RECURRING APPOINTMENT SERIES
// ============================================
// NOTE: Recurring series functionality has been moved to lib/actions/recurring-series.ts
// Import directly from that file for:
// - createRecurringSeries, getRecurringSeries, getRecurringSeriesById
// - updateRecurringSeries, updateSeriesAppointments, cancelRecurringSeries
// - pauseSeries, resumeSeries, extendSeries, cloneSeries
// - addExceptionDate, removeExceptionDate, getExceptionDates
// - detachOccurrence, cancelFromDate, getAlternativeSlots
// - getPatternLabel, RecurringSeriesListItem (type)

// ============================================
// APPOINTMENT DEPOSITS / PREPAYMENTS
// ============================================

/**
 * Records a deposit/prepayment against an appointment (before checkout). Stored as
 * a Payment with appointmentId set and invoiceId null — a held prepayment that is
 * applied to the invoice when the appointment is later checked out.
 */
export async function addAppointmentDeposit(
  appointmentId: string,
  data: { amount: number; method: PaymentMethod }
): Promise<ActionResult<{ id: string; depositPaid: number }>> {
  const authResult = await checkAuth("appointments:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }
  // Recording a deposit creates a Payment (real money), so also require a financial permission —
  // editing appointments alone shouldn't grant the ability to take payments.
  if (
    !(await hasPermission(
      authResult.roleId,
      "sales:create",
      authResult.isSuperAdmin,
      authResult.salonId,
      authResult.userId
    ))
  ) {
    return { success: false, error: "You don't have permission to take payments." };
  }

  const parsed = appointmentDepositSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const amount = Math.round(parsed.data.amount * 100) / 100;
  const method = parsed.data.method;
  // For a currency-formatted balance-due message if the deposit exceeds the outstanding amount.
  const currencyCode =
    (await prisma.settings.findUnique({ where: { salonId: authResult.salonId }, select: { currencyCode: true } }))
      ?.currencyCode ?? "USD";

  try {
    // Re-read state, bound the deposit to the outstanding balance, and insert atomically so a
    // concurrent checkout/deposit can't push the appointment past its total. Serializable +
    // retry closes the write-skew window where two deposits both read the same balance.
    const outcome = await runSerializable(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, salonId: authResult.salonId },
        select: {
          id: true,
          status: true,
          sale: { select: { id: true } },
          services: { select: { price: true } },
          payments: { select: { amount: true } },
        },
      });
      if (!appointment) {
        return { ok: false as const, error: "Appointment not found" };
      }
      if (appointment.sale) {
        return { ok: false as const, error: "This appointment has already been checked out." };
      }
      if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
        return { ok: false as const, error: "Can't take a deposit on a cancelled or no-show appointment." };
      }

      const serviceTotal = appointment.services.reduce((sum, s) => sum + Number(s.price), 0);
      const alreadyPaid = appointment.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const outstanding = Math.round((serviceTotal - alreadyPaid) * 100) / 100;
      if (outstanding <= 0) {
        return { ok: false as const, error: "This appointment is already fully prepaid." };
      }
      if (amount > outstanding) {
        return { ok: false as const, error: `Deposit can't exceed the balance due of ${formatCurrency(outstanding, currencyCode)}.` };
      }

      assertPaymentOwner({ appointmentId });
      const payment = await tx.payment.create({
        data: { appointmentId, amount, method },
        select: { id: true },
      });
      return { ok: true as const, paymentId: payment.id, depositPaid: alreadyPaid + amount };
    });

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    await logAudit({
      action: "APPOINTMENT_DEPOSIT_ADDED",
      entityType: "Appointment",
      entityId: appointmentId,
      salonId: authResult.salonId,
      userId: authResult.userId,
      userRole: authResult.role,
      details: { amount, method },
    });

    revalidatePath("/dashboard/appointments");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: { id: outcome.paymentId, depositPaid: outcome.depositPaid } };
  } catch (error) {
    console.error("Error adding appointment deposit:", error);
    return { success: false, error: "Failed to record deposit" };
  }
}
