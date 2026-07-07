"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatInTz } from "@/lib/utils/timezone";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AppointmentDetailModal } from "@/components/appointments/appointment-detail-modal";
import { getAppointment, type AppointmentListItem } from "@/lib/actions/appointment";

// Limited shape carried in the staff-detail page (see UserDetail.appointments).
type Row = {
  id: string;
  startTime: Date;
  endTime: Date;
  status: string;
  client: { firstName: string; lastName: string | null; isWalkIn: boolean };
  services: { service: { name: string } }[];
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  CONFIRMED: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200",
  IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
};

/**
 * Recent-appointments table on a staff profile. Rows open a READ-ONLY appointment drawer
 * (info only — no checkout / lifecycle / edit), scoped to the staff-detail context.
 */
export function StaffRecentAppointments({
  appointments,
  timezone,
}: {
  appointments: Row[];
  timezone: string;
}) {
  const [selected, setSelected] = useState<AppointmentListItem | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openAppointment = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    const result = await getAppointment(id);
    setLoadingId(null);
    if (result.success) {
      setSelected(result.data);
    } else {
      toast.error(result.error || "Couldn't load this appointment");
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date &amp; Time</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                No appointments yet
              </TableCell>
            </TableRow>
          ) : (
            appointments.map((appointment) => (
              <TableRow
                key={appointment.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => openAppointment(appointment.id)}
              >
                <TableCell>
                  <div>
                    <p className="font-medium">
                      {formatInTz(appointment.startTime, "MMM d, yyyy", timezone)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatInTz(appointment.startTime, "h:mm a", timezone)} -{" "}
                      {formatInTz(appointment.endTime, "h:mm a", timezone)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {appointment.client.firstName} {appointment.client.lastName}
                    {appointment.client.isWalkIn && (
                      <Badge variant="outline" className="text-xs">
                        Walk-in
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {(appointment.services[0]?.service.name ?? "") +
                    (appointment.services.length > 1 ? ` +${appointment.services.length - 1}` : "")}
                  {loadingId === appointment.id && " …"}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_COLORS[appointment.status] || "bg-gray-100"}>
                    {appointment.status.toLowerCase().replace("_", " ")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {selected && (
        <AppointmentDetailModal
          appointment={selected}
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          timezone={timezone}
          readOnly
        />
      )}
    </>
  );
}
