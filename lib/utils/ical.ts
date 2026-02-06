import { format } from "date-fns";

interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  organizer?: {
    name: string;
    email?: string;
  };
  attendee?: {
    name: string;
    email?: string;
  };
  categories?: string[];
  status?: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  sequence?: number;
}

interface ICalRecurringEvent extends ICalEvent {
  rrule?: string; // RRULE string like "FREQ=WEEKLY;BYDAY=MO"
}

/**
 * Format a date to iCal datetime format (UTC)
 * Uses actual UTC values to ensure correct timezone handling
 */
function formatICalDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Format a date to iCal date format
 */
function formatICalDate(date: Date): string {
  return format(date, "yyyyMMdd");
}

/**
 * Escape special characters in iCal text fields
 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Fold long lines according to iCal spec (max 75 chars per line)
 */
function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const lines: string[] = [];
  let remaining = line;

  while (remaining.length > maxLen) {
    lines.push(remaining.substring(0, maxLen));
    remaining = " " + remaining.substring(maxLen);
  }
  lines.push(remaining);

  return lines.join("\r\n");
}

/**
 * Generate a single VEVENT component
 */
function generateVEvent(event: ICalEvent | ICalRecurringEvent): string {
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatICalDateTime(new Date())}`,
    `DTSTART:${formatICalDateTime(event.startTime)}`,
    `DTEND:${formatICalDateTime(event.endTime)}`,
    `SUMMARY:${escapeICalText(event.summary)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }

  if (event.organizer) {
    if (event.organizer.email) {
      lines.push(`ORGANIZER;CN=${escapeICalText(event.organizer.name)}:mailto:${event.organizer.email}`);
    } else {
      lines.push(`ORGANIZER:${escapeICalText(event.organizer.name)}`);
    }
  }

  if (event.attendee) {
    if (event.attendee.email) {
      lines.push(`ATTENDEE;CN=${escapeICalText(event.attendee.name)}:mailto:${event.attendee.email}`);
    }
  }

  if (event.categories && event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeICalText).join(",")}`);
  }

  if (event.status) {
    lines.push(`STATUS:${event.status}`);
  }

  if (event.sequence !== undefined) {
    lines.push(`SEQUENCE:${event.sequence}`);
  }

  // Add RRULE if this is a recurring event
  if ("rrule" in event && event.rrule) {
    lines.push(`RRULE:${event.rrule}`);
  }

  lines.push("END:VEVENT");

  return lines.map(foldLine).join("\r\n");
}

/**
 * Generate a complete iCal calendar file
 */
export function generateICalendar(
  events: (ICalEvent | ICalRecurringEvent)[],
  calendarName: string = "AestheTech Appointments"
): string {
  const calendarLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AestheTech//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICalText(calendarName)}`,
  ];

  const eventStrings = events.map(generateVEvent);

  calendarLines.push(...eventStrings);
  calendarLines.push("END:VCALENDAR");

  return calendarLines.join("\r\n") + "\r\n";
}

/**
 * Generate an RRULE string for recurring appointments
 */
export function generateRRule(params: {
  pattern: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM" | "SPECIFIC_DAYS" | "NTH_WEEKDAY";
  customWeeks?: number | null;
  dayOfWeek?: number; // 0-6 (Sun-Sat)
  specificDays?: number[]; // Array of day numbers
  nthWeek?: number | null; // 1-5 for NTH_WEEKDAY
  endType?: "NEVER" | "AFTER_COUNT" | "BY_DATE";
  endAfterCount?: number | null;
  endByDate?: Date | null;
}): string {
  const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const parts: string[] = [];

  switch (params.pattern) {
    case "DAILY":
      parts.push("FREQ=DAILY");
      break;

    case "WEEKLY":
      parts.push("FREQ=WEEKLY");
      if (params.dayOfWeek !== undefined) {
        parts.push(`BYDAY=${dayMap[params.dayOfWeek]}`);
      }
      break;

    case "BIWEEKLY":
      parts.push("FREQ=WEEKLY");
      parts.push("INTERVAL=2");
      if (params.dayOfWeek !== undefined) {
        parts.push(`BYDAY=${dayMap[params.dayOfWeek]}`);
      }
      break;

    case "MONTHLY":
      parts.push("FREQ=MONTHLY");
      // Monthly on the same date each month (e.g., 15th of every month)
      // For nth weekday patterns (e.g., "first Monday"), use NTH_WEEKDAY instead
      break;

    case "CUSTOM":
      parts.push("FREQ=WEEKLY");
      if (params.customWeeks && params.customWeeks > 1) {
        parts.push(`INTERVAL=${params.customWeeks}`);
      }
      if (params.dayOfWeek !== undefined) {
        parts.push(`BYDAY=${dayMap[params.dayOfWeek]}`);
      }
      break;

    case "SPECIFIC_DAYS":
      parts.push("FREQ=WEEKLY");
      if (params.specificDays && params.specificDays.length > 0) {
        const days = params.specificDays.map((d) => dayMap[d]).join(",");
        parts.push(`BYDAY=${days}`);
      }
      break;

    case "NTH_WEEKDAY":
      parts.push("FREQ=MONTHLY");
      if (params.dayOfWeek !== undefined && params.nthWeek) {
        const weekNum = params.nthWeek === 5 ? -1 : params.nthWeek;
        parts.push(`BYDAY=${weekNum}${dayMap[params.dayOfWeek]}`);
      }
      break;
  }

  // Add end condition
  if (params.endType === "AFTER_COUNT" && params.endAfterCount) {
    parts.push(`COUNT=${params.endAfterCount}`);
  } else if (params.endType === "BY_DATE" && params.endByDate) {
    const until = new Date(params.endByDate);
    until.setUTCHours(23, 59, 59, 0);
    parts.push(`UNTIL=${formatICalDateTime(until)}`);
  }

  return parts.join(";");
}

/**
 * Generate iCal content for a single appointment
 */
export function generateAppointmentIcal(appointment: {
  id: string;
  startTime: Date;
  endTime: Date;
  service: { name: string };
  staff: { firstName: string; lastName: string };
  client: { firstName: string; lastName: string | null; email?: string | null };
  notes?: string | null;
  status?: string;
}): string {
  const clientName = `${appointment.client.firstName}${appointment.client.lastName ? ` ${appointment.client.lastName}` : ""}`.trim();
  const staffName = `${appointment.staff.firstName} ${appointment.staff.lastName}`.trim();

  const event: ICalEvent = {
    uid: `${appointment.id}@aesthetech.app`,
    summary: `${appointment.service.name} - ${clientName}`,
    description: [
      `Service: ${appointment.service.name}`,
      `Staff: ${staffName}`,
      `Client: ${clientName}`,
      appointment.notes ? `Notes: ${appointment.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    startTime: new Date(appointment.startTime),
    endTime: new Date(appointment.endTime),
    attendee: appointment.client.email
      ? {
          name: clientName,
          email: appointment.client.email,
        }
      : undefined,
    organizer: {
      name: staffName,
    },
    categories: ["Appointment", appointment.service.name],
    status: appointment.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
  };

  return generateICalendar([event], "AestheTech Appointment");
}

/**
 * Generate iCal content for a recurring series
 */
export function generateSeriesIcal(series: {
  id: string;
  pattern: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM" | "SPECIFIC_DAYS" | "NTH_WEEKDAY";
  customWeeks: number | null;
  dayOfWeek: number;
  specificDays?: number[];
  nthWeek: number | null;
  timeOfDay: string;
  endType: "NEVER" | "AFTER_COUNT" | "BY_DATE";
  endAfterCount: number | null;
  endByDate: Date | null;
  service: { name: string; duration: number };
  staff: { firstName: string; lastName: string };
  client: { firstName: string; lastName: string | null; email?: string | null };
  notes?: string | null;
  appointments: { startTime: Date }[];
}): string {
  // Use the first upcoming appointment as the base date
  const upcomingAppointments = series.appointments
    .filter((a) => new Date(a.startTime) >= new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (upcomingAppointments.length === 0) {
    // No upcoming appointments, can't generate series
    return "";
  }

  const clientName = `${series.client.firstName}${series.client.lastName ? ` ${series.client.lastName}` : ""}`.trim();
  const staffName = `${series.staff.firstName} ${series.staff.lastName}`.trim();

  const firstAppointment = upcomingAppointments[0];
  const startTime = new Date(firstAppointment.startTime);
  const endTime = new Date(startTime.getTime() + series.service.duration * 60 * 1000);

  const rrule = generateRRule({
    pattern: series.pattern,
    customWeeks: series.customWeeks,
    dayOfWeek: series.dayOfWeek,
    specificDays: series.specificDays,
    nthWeek: series.nthWeek,
    endType: series.endType,
    endAfterCount: series.endAfterCount,
    endByDate: series.endByDate,
  });

  const event: ICalRecurringEvent = {
    uid: `series-${series.id}@aesthetech.app`,
    summary: `${series.service.name} - ${clientName}`,
    description: [
      `Recurring ${series.service.name}`,
      `Staff: ${staffName}`,
      `Client: ${clientName}`,
      series.notes ? `Notes: ${series.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    startTime,
    endTime,
    attendee: series.client.email
      ? {
          name: clientName,
          email: series.client.email,
        }
      : undefined,
    organizer: {
      name: staffName,
    },
    categories: ["Recurring Appointment", series.service.name],
    status: "CONFIRMED",
    rrule,
  };

  return generateICalendar([event], `${series.service.name} - Recurring Series`);
}

/**
 * Generate iCal content for multiple appointments (e.g., all appointments in a series)
 */
export function generateMultipleAppointmentsIcal(
  appointments: {
    id: string;
    startTime: Date;
    endTime: Date;
    service: { name: string };
    staff: { firstName: string; lastName: string };
    client: { firstName: string; lastName: string | null; email?: string | null };
    notes?: string | null;
    status?: string;
  }[],
  calendarName?: string
): string {
  const events: ICalEvent[] = appointments.map((apt) => {
    const clientName = `${apt.client.firstName}${apt.client.lastName ? ` ${apt.client.lastName}` : ""}`.trim();
    const staffName = `${apt.staff.firstName} ${apt.staff.lastName}`.trim();

    return {
      uid: `${apt.id}@aesthetech.app`,
      summary: `${apt.service.name} - ${clientName}`,
      description: [
        `Service: ${apt.service.name}`,
        `Staff: ${staffName}`,
        `Client: ${clientName}`,
        apt.notes ? `Notes: ${apt.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      startTime: new Date(apt.startTime),
      endTime: new Date(apt.endTime),
      attendee: apt.client.email
        ? {
            name: clientName,
            email: apt.client.email,
          }
        : undefined,
      organizer: {
        name: staffName,
      },
      categories: ["Appointment", apt.service.name],
      status: apt.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
    };
  });

  return generateICalendar(events, calendarName || "AestheTech Appointments");
}
