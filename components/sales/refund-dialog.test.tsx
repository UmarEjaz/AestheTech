// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockCreateRefund = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("@/lib/actions/invoice", () => ({ createRefund: (...a: unknown[]) => mockCreateRefund(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: vi.fn() } }));

import { RefundDialog } from "./refund-dialog";

const refundWith = async (data: { pointsTaken: number; pointsReturned: number }): Promise<void> => {
  mockCreateRefund.mockResolvedValue({ success: true, data: { refundId: "r1", pointsReversed: data.pointsTaken, ...data } });
  render(<RefundDialog invoiceId="inv1" invoiceNumber="INV-1" maxRefundable={20} currencyCode="USD" clientName="Jennifer Smith" open hideTrigger />);
  fireEvent.click(screen.getByRole("button", { name: /process refund/i }));
  await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RefundDialog", () => {
  it("tells staff, on a full refund, what happens to the client's points", () => {
    render(<RefundDialog invoiceId="inv1" invoiceNumber="INV-1" maxRefundable={20} currencyCode="USD" clientName="Jennifer Smith" open hideTrigger />);
    expect(screen.getByText(/Points it earned come off the client; any points they spent on it go back\./)).toBeInTheDocument();
  });

  it("names the points taken back and the spent points returned", async () => {
    await refundWith({ pointsTaken: 40, pointsReturned: 50 });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Refund of $20.00 processed for Jennifer Smith. 40 loyalty points taken back. 50 loyalty points spent on it returned to Jennifer Smith."
    );
  });

  it("names only the points taken back when none were spent, in the singular for one", async () => {
    await refundWith({ pointsTaken: 1, pointsReturned: 0 });
    expect(mockToastSuccess).toHaveBeenCalledWith("Refund of $20.00 processed for Jennifer Smith. 1 loyalty point taken back.");
  });

  it("says just that the refund went through when no points moved", async () => {
    await refundWith({ pointsTaken: 0, pointsReturned: 0 });
    expect(mockToastSuccess).toHaveBeenCalledWith("Refund of $20.00 processed for Jennifer Smith.");
  });
});
