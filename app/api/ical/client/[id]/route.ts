import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateICalendar, generateRRule } from "@/lib/utils/ical";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = session.user.role as Role;
    if (!hasPermission(role, "clients:view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: clientId } = await params;

    // Fetch the client to get their name
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
      },
    });

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Fetch all active recurring series for this client
    const allSeries = await prisma.recurringAppointmentSeries.findMany({
      where: {
        clientId,
        isActive: true,
      },
      include: {
        service: { select: { name: true, duration: true } },
        staff: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true, email: true } },
        appointments: {
          where: {
            status: { not: "CANCELLED" },
          },
          orderBy: { startTime: "asc" },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            notes: true,
            status: true,
          },
        },
      },
    });

    if (allSeries.length === 0) {
      return NextResponse.json(
        { error: "No active recurring series found for this client" },
        { status: 404 }
      );
    }

    // Generate iCal events for each series
    const allEvents: {
      uid: string;
      summary: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      organizer?: { name: string };
      attendee?: { name: string; email?: string };
      categories?: string[];
      status?: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
      rrule?: string;
    }[] = [];

    for (const series of allSeries) {
      // Get upcoming appointments for this series
      const upcomingAppointments = series.appointments
        .filter((a) => new Date(a.startTime) >= new Date())
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcomingAppointments.length === 0) continue;

      const clientName = `${series.client.firstName}${series.client.lastName ? ` ${series.client.lastName}` : ""}`.trim();
      const staffName = `${series.staff.firstName} ${series.staff.lastName}`.trim();

      const firstAppointment = upcomingAppointments[0];
      const startTime = new Date(firstAppointment.startTime);
      const endTime = new Date(startTime.getTime() + series.service.duration * 60 * 1000);

      // Generate RRULE using shared utility
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

      allEvents.push({
        uid: `series-${series.id}@aesthetech.app`,
        summary: `${series.service.name} - ${clientName}`,
        description: [
          `Recurring ${series.service.name}`,
          `Staff: ${staffName}`,
          `Client: ${clientName}`,
          series.notes ? `Notes: ${series.notes}` : "",
        ]
          .filter(Boolean)
          .join("\\n"),
        startTime,
        endTime,
        attendee: series.client.email
          ? { name: clientName, email: series.client.email }
          : undefined,
        organizer: { name: staffName },
        categories: ["Recurring Appointment", series.service.name],
        status: "CONFIRMED",
        rrule,
      });
    }

    if (allEvents.length === 0) {
      return NextResponse.json(
        { error: "No upcoming appointments found in any series" },
        { status: 400 }
      );
    }

    // Generate the combined iCal file
    const clientFullName = `${client.firstName}${client.lastName ? ` ${client.lastName}` : ""}`.trim();
    const icalContent = generateICalendar(allEvents, `${clientFullName} - All Recurring Appointments`);

    const filename = `all-recurring-${client.firstName.toLowerCase()}.ics`;

    return new NextResponse(icalContent, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating client iCal:", error);
    return NextResponse.json(
      { error: "Failed to generate calendar file" },
      { status: 500 }
    );
  }
}
