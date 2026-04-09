"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { EventDropArg, EventClickArg, DatesSetArg } from "@fullcalendar/core";
import { ShiftType } from "@prisma/client";
import { toast } from "sonner";

import { reassignSchedule } from "@/lib/actions/schedule";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface Schedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  isAvailable: boolean;
}

interface StaffWithSchedules {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roleLabel?: string;
  schedules: Schedule[];
}

interface ScheduleMonthViewProps {
  staffWithSchedules: StaffWithSchedules[];
  canManage: boolean;
  onEditSchedule?: (staffId: string, dayOfWeek: number, schedule?: Schedule) => void;
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

const SHIFT_BG_COLORS: Record<ShiftType, string> = {
  OPENING: "#3b82f6",
  CLOSING: "#8b5cf6",
  REGULAR: "#22c55e",
  SPLIT: "#f97316",
};

export function ScheduleMonthView({
  staffWithSchedules,
  canManage,
  onEditSchedule,
}: ScheduleMonthViewProps) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);

  // Track the visible date range so we generate events for whichever month is shown
  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setVisibleRange({ start: arg.start, end: arg.end });
  }, []);

  // Convert weekly schedules into recurring FullCalendar events
  const events = useMemo(() => {
    // Use visible range if available, otherwise default ±6 weeks
    const today = new Date();
    const startDate = visibleRange?.start ?? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 42);
    const endDate = visibleRange?.end ?? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 42);

    const result: {
      id: string;
      title: string;
      start: string;
      end: string;
      backgroundColor: string;
      borderColor: string;
      textColor: string;
      editable: boolean;
      extendedProps: {
        scheduleId: string;
        staffId: string;
        dayOfWeek: number;
        schedule: Schedule;
        staffName: string;
      };
    }[] = [];

    for (const staff of staffWithSchedules) {
      for (const schedule of staff.schedules) {
        // Find all dates within the window that match this dayOfWeek
        const current = new Date(startDate);
        // Advance to the first matching day
        while (current.getDay() !== schedule.dayOfWeek) {
          current.setDate(current.getDate() + 1);
        }

        while (current <= endDate) {
          // Build date string from local fields to avoid UTC shift
          const dateStr = [
            current.getFullYear(),
            String(current.getMonth() + 1).padStart(2, "0"),
            String(current.getDate()).padStart(2, "0"),
          ].join("-");
          const bgColor = schedule.isAvailable
            ? SHIFT_BG_COLORS[schedule.shiftType]
            : "#9ca3af";

          result.push({
            id: `${schedule.id}-${dateStr}`,
            title: `${staff.firstName} ${staff.lastName} (${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)})`,
            start: `${dateStr}T${schedule.startTime}:00`,
            end: `${dateStr}T${schedule.endTime}:00`,
            backgroundColor: bgColor,
            borderColor: bgColor,
            textColor: "#ffffff",
            editable: canManage && schedule.isAvailable,
            extendedProps: {
              scheduleId: schedule.id,
              staffId: staff.id,
              dayOfWeek: schedule.dayOfWeek,
              schedule,
              staffName: `${staff.firstName} ${staff.lastName}`,
            },
          });

          current.setDate(current.getDate() + 7);
        }
      }
    }

    return result;
  }, [staffWithSchedules, canManage, visibleRange]);

  // Handle drag-and-drop: reassign schedule to a new day of week
  const handleEventDrop = useCallback(
    async (arg: EventDropArg) => {
      if (isProcessing) {
        arg.revert();
        return;
      }

      const newDate = arg.event.start;
      if (!newDate) {
        arg.revert();
        return;
      }

      const newDayOfWeek = newDate.getDay();
      const { scheduleId, dayOfWeek: oldDayOfWeek } = arg.event.extendedProps;

      // If dropped on same day of week, revert (no change needed)
      if (newDayOfWeek === oldDayOfWeek) {
        arg.revert();
        return;
      }

      setIsProcessing(true);
      try {
        const result = await reassignSchedule(scheduleId, newDayOfWeek);

        if (!result.success) {
          arg.revert();
          toast.error(result.error || "Failed to move schedule");
          return;
        }

        toast.success(`Schedule moved to ${DAY_NAMES[newDayOfWeek]}`);
        router.refresh();
      } catch {
        arg.revert();
        toast.error("Failed to move schedule");
      } finally {
        setIsProcessing(false);
      }
    },
    [router, isProcessing]
  );

  // Handle click on event to edit
  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      if (!canManage || !onEditSchedule) return;
      const { staffId, dayOfWeek, schedule } = arg.event.extendedProps;
      onEditSchedule(staffId, dayOfWeek, schedule);
    },
    [canManage, onEditSchedule]
  );

  return (
    <div className="schedule-month-calendar">
      <style jsx global>{`
        .schedule-month-calendar .fc {
          --fc-border-color: hsl(var(--border));
          --fc-button-bg-color: hsl(var(--primary));
          --fc-button-border-color: hsl(var(--primary));
          --fc-button-hover-bg-color: hsl(var(--primary) / 0.9);
          --fc-button-hover-border-color: hsl(var(--primary) / 0.9);
          --fc-button-active-bg-color: hsl(var(--primary) / 0.8);
          --fc-button-active-border-color: hsl(var(--primary) / 0.8);
          --fc-today-bg-color: hsl(var(--primary) / 0.1);
        }

        .schedule-month-calendar .fc-theme-standard td,
        .schedule-month-calendar .fc-theme-standard th {
          border-color: hsl(var(--border));
        }

        .schedule-month-calendar .fc-col-header-cell {
          background: hsl(var(--muted));
          padding: 8px 0;
        }

        .schedule-month-calendar .fc-col-header-cell-cushion {
          color: hsl(var(--foreground));
          font-weight: 500;
        }

        .schedule-month-calendar .fc-daygrid-day-number {
          color: hsl(var(--foreground));
        }

        .schedule-month-calendar .fc-event {
          cursor: pointer;
          padding: 2px 4px;
          font-size: 0.7rem;
          border-radius: 4px;
          margin-bottom: 1px;
        }

        .schedule-month-calendar .fc-event.fc-event-draggable {
          cursor: grab;
        }

        .schedule-month-calendar .fc-event.fc-event-draggable:active {
          cursor: grabbing;
        }

        .schedule-month-calendar .fc-toolbar-title {
          color: hsl(var(--foreground));
          font-size: 1.25rem !important;
        }

        .schedule-month-calendar .fc-button {
          font-size: 0.875rem !important;
          padding: 0.5rem 1rem !important;
        }

        .dark .schedule-month-calendar .fc-day-today {
          background-color: hsl(var(--primary) / 0.15) !important;
        }
      `}</style>

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "",
        }}
        events={events}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        height="auto"
        dayMaxEvents={4}
        weekends={true}
        eventDisplay="block"
      />
    </div>
  );
}
