// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { ReceiptSettingsCard } from "./receipt-settings-card";

// A stand-in for `register("receiptFooter")`; the card only spreads it onto the textarea.
const footerField: UseFormRegisterReturn = {
  name: "receiptFooter",
  onChange: vi.fn(async () => {}),
  onBlur: vi.fn(async () => {}),
  ref: vi.fn(),
};

describe("ReceiptSettingsCard", () => {
  it("renders the Receipts card with the saved size selected", () => {
    render(
      <ReceiptSettingsCard canManage receiptSize="A5" onReceiptSizeChange={vi.fn()} footerField={footerField} />
    );
    expect(screen.getByText("Receipts")).toBeInTheDocument();
    // Radix Select shows the selected option's text in the trigger; the hint for that size sits below.
    expect(screen.getByText("A5 (half page)")).toBeInTheDocument();
    expect(screen.getByText(/Half a normal sheet, on a regular printer\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Footer note (optional)")).not.toBeDisabled();
  });

  it("disables the size selector and footer note when the user can't manage settings", () => {
    render(
      <ReceiptSettingsCard
        canManage={false}
        receiptSize="A5"
        onReceiptSizeChange={vi.fn()}
        footerField={footerField}
      />
    );
    expect(screen.getByText("A5 (half page)").closest("button")).toBeDisabled();
    expect(screen.getByLabelText("Footer note (optional)")).toBeDisabled();
  });

  it("shows the footer validation message when given one", () => {
    render(
      <ReceiptSettingsCard
        canManage
        receiptSize="THERMAL_80"
        onReceiptSizeChange={vi.fn()}
        footerField={footerField}
        footerError="Footer note must be 300 characters or fewer"
      />
    );
    expect(screen.getByText("Footer note must be 300 characters or fewer")).toBeInTheDocument();
  });
});
