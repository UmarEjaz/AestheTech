// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { PRINTING_CLASS, PrintOverlay, usePrintOverlay } from "./receipt-print-overlay";

const FILE_BASE = "Jennifer Smith - Receipt INV-000123";

function Harness(): ReactElement {
  const { printing, print } = usePrintOverlay(FILE_BASE);
  return (
    <>
      <button onClick={print}>Print it</button>
      <PrintOverlay open={printing} size="A5">
        <div>RECEIPT BODY</div>
      </PrintOverlay>
    </>
  );
}

describe("usePrintOverlay + PrintOverlay", () => {
  const originalTitle = "AestheTech";
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.title = originalTitle;
    document.body.classList.remove(PRINTING_CLASS);
    printSpy = vi.fn();
    window.print = printSpy as unknown as typeof window.print; // jsdom has no print dialog
  });
  afterEach(() => {
    document.body.classList.remove(PRINTING_CLASS);
  });

  it("renders nothing and leaves the page alone until asked to print", () => {
    render(<Harness />);
    expect(screen.queryByText("RECEIPT BODY")).toBeNull();
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(document.title).toBe(originalTitle);
  });

  it("mounts the overlay, marks <body>, swaps the title to the file name, prints, and restores on afterprint", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Print it"));

    // The overlay is in the document (portaled to <body>) with the per-size @page rule beside it.
    expect(screen.getByText("RECEIPT BODY")).toBeInTheDocument();
    expect(document.body.querySelector(".receipt-print-root style")?.textContent).toContain("@page");
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(true);
    expect(document.title).toBe(FILE_BASE);
    expect(printSpy).not.toHaveBeenCalled(); // not synchronously: the overlay must be painted first
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1)); // on the next animation frame

    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(screen.queryByText("RECEIPT BODY")).toBeNull());
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(document.title).toBe(originalTitle);
  });

  it("restores the title and <body> if the component unmounts mid-print", async () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByText("Print it"));
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    unmount();
    expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
    expect(document.title).toBe(originalTitle);
    expect(document.body.querySelector(".receipt-print-root")).toBeNull();
  });
});
