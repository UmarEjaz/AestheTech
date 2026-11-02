// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockCancel = vi.fn();
const mockRefresh = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("@/lib/actions/invoice-cancel", () => ({ cancelInvoice: (...a: unknown[]) => mockCancel(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: vi.fn() } }));

import { CancelInvoiceDialog, cancelToast } from "./cancel-invoice-dialog";

const props = {
  open: true,
  onOpenChange: vi.fn(),
  invoiceId: "inv1",
  invoiceNumber: "INV-000123",
  clientName: "Jennifer Smith",
  currencyCode: "USD",
  paidAmount: 30,
  canRefundMoney: true,
};
const cancelButton = (): HTMLElement => screen.getByRole("button", { name: "Cancel invoice" });

afterEach((): void => {
  vi.restoreAllMocks(); // undo the console.error silencing spy, even when a test fails early
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCancel.mockResolvedValue({ success: true, data: { refunded: 30, kept: 0, pointsTakenBack: 12, pointsReturned: 0 } });
});

describe("CancelInvoiceDialog", () => {
  it("asks what happens to money already paid, and won't cancel until staff choose", async () => {
    render(<CancelInvoiceDialog {...props} />);
    expect(screen.getByText("$30.00 has been paid on this bill. Choose what happens to it. This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Says why the button is disabled, and ties the hint to it for screen readers.
    expect(cancelButton()).toBeDisabled();
    expect(cancelButton()).toHaveAccessibleDescription("Choose Refund or Keep to continue.");
    fireEvent.click(screen.getByRole("radio", { name: /Refund \$30\.00 to Jennifer Smith/ }));
    fireEvent.click(cancelButton());
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith({ invoiceId: "inv1", paidMoney: "REFUND", expectedPaid: 30 }));
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Invoice INV-000123 cancelled. $30.00 refunded to Jennifer Smith. 12 loyalty points taken back."
    );
  });

  it("offers only Keep to someone who can't refund, already selected", () => {
    render(<CancelInvoiceDialog {...props} canRefundMoney={false} />);
    expect(screen.getByRole("radio", { name: /Refund/ })).toBeDisabled();
    expect(screen.getByText(/You don't have permission to refund/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Keep \$30\.00/ })).toBeChecked();
    expect(cancelButton()).toBeEnabled();
    // Nothing to choose, so it says what will happen instead.
    expect(screen.getByText(/will be kept as a cancellation fee\. This can't be undone\./)).toBeInTheDocument();
  });

  it("names the choice for screen readers", () => {
    render(<CancelInvoiceDialog {...props} />);
    expect(screen.getByRole("radiogroup", { name: "What happens to the $30.00 already paid" })).toBeInTheDocument();
  });

  it("forgets the choice when staff back out with Don't cancel", () => {
    const { rerender } = render(<CancelInvoiceDialog {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Keep \$30\.00/ }));
    expect(cancelButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Don't cancel" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<CancelInvoiceDialog {...props} />);
    expect(cancelButton()).toBeDisabled();
  });

  it("reloads the live figures when the server refuses (e.g. a payment just landed)", async () => {
    mockCancel.mockResolvedValue({ success: false, error: "This invoice just changed. Please reload and try again." });
    render(<CancelInvoiceDialog {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Keep \$30\.00/ }));
    fireEvent.click(cancelButton());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // The amount may have changed: staff must choose again for the new figure.
    await waitFor(() => expect(cancelButton()).toBeDisabled());
  });

  it("reloads the live state if the cancel fails mid-way (it may have gone through)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockCancel.mockRejectedValue(new Error("network"));
    render(<CancelInvoiceDialog {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Keep \$30\.00/ }));
    fireEvent.click(cancelButton());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(cancelButton()).toBeDisabled());
  });

  it("can't be closed while the cancel is saving", async () => {
    mockCancel.mockReturnValue(new Promise(() => {})); // never settles
    render(<CancelInvoiceDialog {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Keep \$30\.00/ }));
    fireEvent.click(cancelButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Don't cancel" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("cancels an unpaid bill straight away, with no money question", async () => {
    mockCancel.mockResolvedValue({ success: true, data: { refunded: 0, kept: 0, pointsTakenBack: 0, pointsReturned: 0 } });
    render(<CancelInvoiceDialog {...props} paidAmount={0} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/Any points spent on it go back to the client\./)).toBeInTheDocument();
    fireEvent.click(cancelButton());
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith({ invoiceId: "inv1", paidMoney: undefined, expectedPaid: 0 }));
  });
});

describe("cancelToast", () => {
  it("names what became of the money and the points", () => {
    expect(cancelToast("INV-1", "Sam", { refunded: 0, kept: 30, pointsTakenBack: 1, pointsReturned: 0 }, "USD")).toBe(
      "Invoice INV-1 cancelled. $30.00 kept as a cancellation fee. 1 loyalty point taken back."
    );
    expect(cancelToast("INV-1", "Sam", { refunded: 0, kept: 0, pointsTakenBack: 0, pointsReturned: 0 }, "USD")).toBe("Invoice INV-1 cancelled.");
    expect(cancelToast("INV-1", "Sam", { refunded: 20, kept: 0, pointsTakenBack: 5, pointsReturned: 100 }, "USD")).toBe(
      "Invoice INV-1 cancelled. $20.00 refunded to Sam. 5 loyalty points taken back. 100 loyalty points spent on it returned to Sam."
    );
  });
});
