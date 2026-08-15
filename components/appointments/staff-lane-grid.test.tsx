// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaffLaneGrid } from "./staff-lane-grid";
import type { AppointmentListItem } from "@/lib/actions/appointment";

// Asia/Karachi is UTC+5 with no DST; 04:00Z = 09:00 local.
const TZ = "Asia/Karachi";
const DAY = new Date("2026-08-17T04:00:00Z");

// Minimal AppointmentListItem fixture — only the fields the grid actually reads at render time.
function makeAppt(over: Partial<Record<string, unknown>> = {}): AppointmentListItem {
  return {
    id: "apt_1",
    startTime: new Date("2026-08-17T04:00:00Z"), // 9:00 AM local
    endTime: new Date("2026-08-17T04:30:00Z"), //  9:30 AM local
    status: "SCHEDULED",
    client: { firstName: "Jennifer", lastName: "Smith", isWalkIn: false },
    series: null,
    services: [
      {
        duration: 30,
        staff: { id: "stf_1", firstName: "Emma", lastName: "Wilson" },
        service: { name: "Beard Trim" },
      },
    ],
    ...over,
  } as unknown as AppointmentListItem;
}

const baseProps = {
  staff: [{ id: "stf_1", firstName: "Emma", lastName: "Wilson" }],
  date: DAY,
  span: "day" as const,
  businessHoursStart: "09:00",
  businessHoursEnd: "19:00",
  timezone: TZ,
  onSelectAppointment: vi.fn(),
};

describe("StaffLaneGrid", () => {
  it("shows the empty-state card when there are no appointments", () => {
    render(<StaffLaneGrid {...baseProps} appointments={[]} onEmptyBook={vi.fn()} onEmptyToday={vi.fn()} />);
    expect(screen.getByText("No appointments this day")).toBeInTheDocument();
  });

  it("shows a message when there are no providers", () => {
    render(<StaffLaneGrid {...baseProps} staff={[]} appointments={[]} />);
    expect(screen.getByText(/No service providers to show lanes for/i)).toBeInTheDocument();
  });

  it("renders an appointment block with the client name, time range and service", () => {
    render(<StaffLaneGrid {...baseProps} appointments={[makeAppt()]} />);
    expect(screen.getByText("Jennifer Smith")).toBeInTheDocument();
    // Block shows the compact range + the service name.
    expect(screen.getByText(/9–9:30 AM · Beard Trim/)).toBeInTheDocument();
  });

  it("shows a loading spinner while loading", () => {
    const { container } = render(<StaffLaneGrid {...baseProps} appointments={[]} loading />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("books the focused slot when Enter is pressed (keyboard)", () => {
    const onBookSlot = vi.fn();
    render(<StaffLaneGrid {...baseProps} appointments={[]} canCreate onBookSlot={onBookSlot} />);
    const grid = screen.getByLabelText(/Staff schedule/i);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onBookSlot).toHaveBeenCalledTimes(1);
    // First column is the only provider; the ISO string carries its start.
    expect(onBookSlot.mock.calls[0][0]).toBe("stf_1");
    expect(typeof onBookSlot.mock.calls[0][1]).toBe("string");
  });
});
