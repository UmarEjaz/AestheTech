// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarEmptyState } from "./calendar-empty-state";

describe("CalendarEmptyState", () => {
  it("names the empty period in the heading", () => {
    render(<CalendarEmptyState span="week" />);
    expect(screen.getByText("No appointments this week")).toBeInTheDocument();
  });

  it("uses the month label for the month view", () => {
    render(<CalendarEmptyState span="month" />);
    expect(screen.getByText("No appointments this month")).toBeInTheDocument();
  });

  it("shows a Book Appointment button that calls onBook", async () => {
    const onBook = vi.fn();
    render(<CalendarEmptyState span="day" onBook={onBook} />);
    await userEvent.click(screen.getByRole("button", { name: /book appointment/i }));
    expect(onBook).toHaveBeenCalledOnce();
  });

  it("shows Jump to today only when onToday is provided, and calls it", async () => {
    const onToday = vi.fn();
    render(<CalendarEmptyState span="week" onToday={onToday} />);
    await userEvent.click(screen.getByRole("button", { name: /jump to today/i }));
    expect(onToday).toHaveBeenCalledOnce();
  });

  it("hides both actions when no handlers are given", () => {
    render(<CalendarEmptyState span="week" />);
    expect(screen.queryByRole("button", { name: /book appointment/i })).toBeNull();
    expect(screen.queryByText(/jump to today/i)).toBeNull();
  });
});
