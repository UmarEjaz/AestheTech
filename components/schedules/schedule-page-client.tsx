"use client";

import { useState } from "react";
import { ShiftType, Role } from "@prisma/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, CalendarRange } from "lucide-react";
import { ScheduleWeekView } from "./schedule-week-view";
import { ScheduleMonthView } from "./schedule-month-view";
import { SchedulePDFExportButton } from "./schedule-pdf";

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
  role: Role;
  schedules: Schedule[];
}

interface SchedulePageClientProps {
  staffWithSchedules: StaffWithSchedules[];
  canManage: boolean;
  salonName: string;
}

export function SchedulePageClient({
  staffWithSchedules,
  canManage,
  salonName,
}: SchedulePageClientProps) {
  const [view, setView] = useState<string>("week");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Staff Schedules</h1>
          <p className="text-muted-foreground">
            Manage working hours and availability for all staff members
          </p>
        </div>
        <SchedulePDFExportButton
          staffWithSchedules={staffWithSchedules}
          salonName={salonName}
        />
      </div>

      {/* View Tabs */}
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="week" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Week
          </TabsTrigger>
          <TabsTrigger value="month" className="gap-2">
            <CalendarRange className="h-4 w-4" />
            Month
          </TabsTrigger>
        </TabsList>

        <TabsContent value="week" className="mt-4">
          <ScheduleWeekView
            staffWithSchedules={staffWithSchedules}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="month" className="mt-4">
          <ScheduleMonthView
            staffWithSchedules={staffWithSchedules}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
