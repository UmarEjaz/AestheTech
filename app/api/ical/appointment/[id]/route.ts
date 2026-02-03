import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAppointmentIcal } from "@/lib/utils/ical";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appointmentId } = await params;

    // Fetch the appointment with all related data
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        service: { select: { name: true, duration: true } },
        staff: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    const icalContent = generateAppointmentIcal({
      id: appointment.id,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      service: appointment.service,
      staff: appointment.staff,
      client: appointment.client,
      notes: appointment.notes,
      status: appointment.status,
    });

    const filename = `appointment-${appointment.client.firstName.toLowerCase()}-${new Date(appointment.startTime).toISOString().split("T")[0]}.ics`;

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
