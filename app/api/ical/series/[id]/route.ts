import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSeriesIcal, generateMultipleAppointmentsIcal } from "@/lib/utils/ical";
import { RecurrencePattern, RecurrenceEndType } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: seriesId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const exportType = searchParams.get("type") || "series"; // "series" or "appointments"

    // Fetch the recurring series with all related data
    const series = await prisma.recurringAppointmentSeries.findUnique({
      where: { id: seriesId },
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

    if (!series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    let icalContent: string;
    let filename: string;

    if (exportType === "appointments") {
      // Export each appointment as a separate event
      const appointmentsWithFullData = series.appointments.map((apt) => ({
        ...apt,
        service: series.service,
        staff: series.staff,
        client: series.client,
      }));

      icalContent = generateMultipleAppointmentsIcal(
        appointmentsWithFullData,
        `${series.service.name} - ${series.client.firstName} ${series.client.lastName}`
      );
      filename = `appointments-${series.client.firstName.toLowerCase()}-${series.service.name.toLowerCase().replace(/\s+/g, "-")}.ics`;
    } else {
      // Export as a recurring series
      icalContent = generateSeriesIcal({
        id: series.id,
        pattern: series.pattern as RecurrencePattern,
        customWeeks: series.customWeeks,
        dayOfWeek: series.dayOfWeek,
        specificDays: series.specificDays,
        nthWeek: series.nthWeek,
        timeOfDay: series.timeOfDay,
        endType: series.endType as RecurrenceEndType,
        endAfterCount: series.endAfterCount,
        endByDate: series.endByDate,
        service: series.service,
        staff: series.staff,
        client: series.client,
        notes: series.notes,
        appointments: series.appointments,
      });
      filename = `recurring-${series.client.firstName.toLowerCase()}-${series.service.name.toLowerCase().replace(/\s+/g, "-")}.ics`;
    }

    if (!icalContent) {
      return NextResponse.json(
        { error: "No upcoming appointments to export" },
        { status: 400 }
      );
    }

    // Return the iCal file
    return new NextResponse(icalContent, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating iCal:", error);
    return NextResponse.json(
      { error: "Failed to generate calendar file" },
      { status: 500 }
    );
  }
}
