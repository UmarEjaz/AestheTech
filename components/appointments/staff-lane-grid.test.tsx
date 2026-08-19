// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaffLaneGrid } from "./staff-lane-grid";
import type { AppointmentListItem } from "@/lib/actions/appointment";

// Asia/Karachi is UTC+5 with no DST; 04:00Z = 09:00 local.
const TZ = "Asia/Karachi";
const DAY = new Date("2026-08-17T04:00:00Z");

// Minimal AppointmentListItem fixture — only the fields the grid actually reads at render time.
function makeAppt(over: Partial<AppointmentListItem> = {}): AppointmentListItem {
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
  beforeEach(() => {
    // Shared spies (e.g. baseProps.onSelectAppointment) live at module scope; reset call counts so
    // one test never reads state left by another.
    vi.clearAllMocks();
  });

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

  it("calls onSelectAppointment when an appointment block is clicked", () => {
    render(<StaffLaneGrid {...baseProps} appointments={[makeAppt()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Jennifer Smith/i }));
    expect(baseProps.onSelectAppointment).toHaveBeenCalledWith("apt_1");
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

  it("renders one lane per day in the week span (dayKeys × staff)", () => {
    // Week span builds a Sun–Sat column set; with a single provider that's 7 lanes, and the
    // appointment still shows in its own day's lane.
    const { container } = render(
      <StaffLaneGrid {...baseProps} span="week" appointments={[makeAppt()]} />
    );
    expect(container.querySelectorAll("[data-lane]")).toHaveLength(7);
    expect(screen.getByText("Jennifer Smith")).toBeInTheDocument();
  });

  it("clusters overlapping appointments in one lane behind a '+N more' pill", () => {
    // Overlaps in a single provider lane (only possible via cancelled/no-show rows in real data) are
    // collapsed to one visible block (earliest active) plus a "+N more" pill that reveals the rest.
    // The grid only reads firstName/lastName/isWalkIn from a client — cast a partial one for the fixture.
    const client = (firstName: string, lastName: string) =>
      ({ firstName, lastName, isWalkIn: false }) as AppointmentListItem["client"];
    const a = makeAppt({ id: "apt_a", client: client("Alice", "A") });
    const b = makeAppt({
      id: "apt_b",
      client: client("Bob", "B"),
      startTime: new Date("2026-08-17T04:15:00Z"), // 9:15 AM local — overlaps a's 9:00–9:30
      endTime: new Date("2026-08-17T04:45:00Z"),
    });
    render(<StaffLaneGrid {...baseProps} appointments={[a, b]} />);

    // The earliest shows as the block; the overlapping one hides behind the pill (not yet in the DOM).
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.queryByText("Bob B")).toBeNull();
    const morePill = screen.getByRole("button", { name: /1 more appointment/i });

    // Opening the pill reveals the clustered appointment (name sits in a "name · time · service" row).
    fireEvent.click(morePill);
    expect(screen.getByText(/Bob B/)).toBeInTheDocument();
  });

  it("warns when an appointment's provider has no lane", () => {
    // makeAppt's service is with "stf_1"; render with a DIFFERENT provider list so it has no lane.
    render(
      <StaffLaneGrid
        {...baseProps}
        staff={[{ id: "stf_other", firstName: "Other", lastName: "Provider" }]}
        appointments={[makeAppt()]}
      />
    );
    expect(screen.getByText(/not shown/i)).toBeInTheDocument();
    expect(screen.queryByText("Jennifer Smith")).toBeNull(); // no lane, so the block isn't rendered
  });
});

// Drag-to-reschedule logic in jsdom. jsdom has no layout, so we stub the lane/block geometry the drag
// math reads (getBoundingClientRect) and pointer capture, then drive raw pointer events. (The full
// user flow is also covered end-to-end in e2e/lane-drag-reschedule.spec.ts.)
describe("StaffLaneGrid — drag to reschedule", () => {
  const domRect = (r: { left: number; right: number; top: number; bottom: number }): DOMRect =>
    ({
      x: r.left,
      y: r.top,
      width: r.right - r.left,
      height: r.bottom - r.top,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      toJSON: () => ({}),
    }) as DOMRect;

  // Two side-by-side lanes (stf_1 left, stf_2 right); the block sits at the top of stf_1 (its 9:00 start).
  const LANE1 = { left: 0, right: 100, top: 0, bottom: 1040 };
  const LANE2 = { left: 100, right: 200, top: 0, bottom: 1040 };
  const BLOCK = { left: 5, right: 95, top: 0, bottom: 52 };
  const twoStaff = [
    { id: "stf_1", firstName: "Emma", lastName: "Wilson" },
    { id: "stf_2", firstName: "Ben", lastName: "Ng" },
  ];

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.hasAttribute("data-lane")) {
        return domRect(this.dataset.staffId === "stf_2" ? LANE2 : LANE1);
      }
      if (this.tagName === "BUTTON" && this.getAttribute("aria-label")?.startsWith("Jennifer")) {
        return domRect(BLOCK);
      }
      return domRect({ left: 0, right: 0, top: 0, bottom: 0 });
    });
    // jsdom doesn't implement pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  function renderDraggable() {
    const onReschedule = vi.fn();
    render(
      <StaffLaneGrid
        {...baseProps}
        staff={twoStaff}
        appointments={[makeAppt()]}
        canDrag
        onReschedule={onReschedule}
      />
    );
    const block = screen.getByRole("button", { name: /Jennifer Smith/i });
    return { onReschedule, block };
  }

  it("reschedules to the dropped lane with the new provider and a snapped start", () => {
    const { onReschedule, block } = renderDraggable();
    fireEvent.pointerDown(block, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(block, { clientX: 150, clientY: 10, pointerId: 1 }); // into stf_2's lane
    fireEvent.pointerUp(block, { clientX: 150, clientY: 10, pointerId: 1 });

    expect(onReschedule).toHaveBeenCalledTimes(1);
    const [apptId, staffId, startISO] = onReschedule.mock.calls[0];
    expect(apptId).toBe("apt_1");
    expect(staffId).toBe("stf_2");
    expect(typeof startISO).toBe("string");
    expect(new Date(startISO as string).getUTCMinutes() % 5).toBe(0); // snapped to SNAP_MIN
  });

  it("does not reschedule when dropped back on the original slot", () => {
    const { onReschedule, block } = renderDraggable();
    fireEvent.pointerDown(block, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(block, { clientX: 50, clientY: 40, pointerId: 1 }); // moves (passes threshold)
    fireEvent.pointerMove(block, { clientX: 50, clientY: 10, pointerId: 1 }); // back to the origin
    fireEvent.pointerUp(block, { clientX: 50, clientY: 10, pointerId: 1 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("cleans up on pointer cancel without rescheduling", () => {
    const { onReschedule, block } = renderDraggable();
    fireEvent.pointerDown(block, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(block, { clientX: 150, clientY: 10, pointerId: 1 });
    fireEvent.pointerCancel(block, { clientX: 150, clientY: 10, pointerId: 1 });
    expect(onReschedule).not.toHaveBeenCalled();
  });
});
