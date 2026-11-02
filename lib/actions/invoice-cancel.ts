"use server";

import { revalidatePath } from "next/cache";
import { Prisma, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import {
  INVOICE_CHANGED,
  recordRefund,
  refundInvoiceInclude,
  RefundRefusal,
  refundSettings,
  undoCancelledSale,
} from "@/lib/refund-core";
import { cancelInvoiceSchema, type CancelInvoiceInput } from "@/lib/validations/invoice-cancel";
import { ActionResult } from "@/lib/types";
import { netPaid } from "@/lib/utils/invoice-status";
import { logAudit } from "./audit";
import { invalidateDashboardCache } from "@/lib/redis";

export interface CancelInvoiceResult {
  refunded: number; // money given back as part of this cancel
  kept: number; // money already paid that the salon keeps (e.g. a cancellation fee)
  pointsTakenBack: number; // loyalty points actually taken off the client's balance
  pointsReturned: number; // points the client had spent on the bill, given back to them
}

const REFUND_REASON = "Invoice cancelled: service not given";
const NO_REFUND_PERMISSION = "You don't have permission to refund. Choose Keep, or ask a manager.";

// A refusal the person can act on; anything else is reported as a generic failure.
class CancelRefusal extends Error {}

/**
 * Cancel a bill that still owes money. When some has already been paid, the person must say what
 * happens to it — refund it (recorded like any other refund) or keep it — so money never ends up stuck
 * on a cancelled bill. Either way the bill's earned and birthday-bonus points are taken back and its
 * products go back into stock; points spent on it are given back unless the salon keeps the money.
 * Cancel, refund, points and stock happen together or not at all.
 */
export async function cancelInvoice(input: CancelInvoiceInput): Promise<ActionResult<CancelInvoiceResult>> {
  const authResult = await checkAuth("invoices:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = cancelInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }
  const { invoiceId, paidMoney, expectedPaid } = parsed.data;

  // Giving money back needs the refund permission as well as the cancel one, resolved for the same
  // salon as the cancel so a salon switch in between can't mix the two. Enforced below only when
  // there is money to give back (an unpaid bill just cancels).
  const refundAuth = paidMoney === "REFUND" ? await checkAuth("invoices:refund") : null;
  const mayRefund = refundAuth?.salonId === authResult.salonId;

  try {
    const { thresholds, currencyCode } = await refundSettings();

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, salonId: authResult.salonId },
        include: refundInvoiceInclude,
      });
      if (!invoice) throw new CancelRefusal("Invoice not found");
      if (invoice.status === InvoiceStatus.PAID) throw new CancelRefusal("Cannot cancel a paid invoice");
      if (invoice.status === InvoiceStatus.CANCELLED) throw new CancelRefusal("Invoice is already cancelled");
      if (invoice.status === InvoiceStatus.REFUNDED) throw new CancelRefusal("Cannot cancel a refunded invoice");

      const paid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const alreadyRefunded = invoice.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const stillPaid = netPaid(paid, alreadyRefunded);
      if (Math.abs(stillPaid - expectedPaid) > 0.005) {
        throw new CancelRefusal(INVOICE_CHANGED);
      }
      if (stillPaid > 0 && !paidMoney) {
        throw new CancelRefusal("Choose whether to refund or keep the money already paid.");
      }
      if (stillPaid > 0 && paidMoney === "REFUND" && !mayRefund) {
        throw new CancelRefusal(NO_REFUND_PERMISSION);
      }

      // Atomic cancel: the predicate on `status` is evaluated together with the UPDATE, so a payment
      // that marks the invoice PAID at the same moment can't be overwritten by this cancel.
      const cancelled = await tx.invoice.updateMany({
        where: {
          id: invoiceId,
          salonId: authResult.salonId,
          status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED, InvoiceStatus.REFUNDED] },
        },
        data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (cancelled.count === 0) throw new CancelRefusal(INVOICE_CHANGED);

      const refund =
        stillPaid > 0 && paidMoney === "REFUND"
          ? await recordRefund(tx, {
              invoice,
              amount: stillPaid,
              reason: REFUND_REASON,
              userId: authResult.userId,
              salonId: authResult.salonId,
              thresholds,
              currencyCode,
            })
          : null;
      // Whatever happened to the money, the service wasn't given: take back the rest of the points the
      // bill earned (a refund above already took its share) and put its products back in stock.
      // This cancel's refund counts for what it really took: when the client's balance was too low to
      // take its share, the rest is taken below, after the points spent on the bill come back.
      const pointsAlreadyReversed =
        invoice.refunds.reduce((sum, r) => sum + r.pointsReversed, 0) + (refund?.pointsTaken ?? 0);
      // A full refund already undid the whole sale (points and stock); otherwise undo it here.
      const undone = refund?.isFullRefund
        ? { pointsTaken: 0, pointsReturned: 0 }
        : await undoCancelledSale(tx, {
            invoice,
            pointsAlreadyReversed,
            // Points spent on the bill follow the money: given back unless the salon keeps what was paid.
            returnSpentPoints: stillPaid === 0 || refund !== null,
            salonId: authResult.salonId,
            thresholds,
          });
      const pointsTakenBack = (refund?.pointsTaken ?? 0) + undone.pointsTaken;
      const pointsReturned = (refund?.pointsReturned ?? 0) + undone.pointsReturned;
      return refund
        ? { invoice, refunded: stillPaid, kept: 0, refund, pointsTakenBack, pointsReturned }
        : { invoice, refunded: 0, kept: stillPaid, refund: null, pointsTakenBack, pointsReturned };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    const { invoice, refunded, kept, refund, pointsTakenBack, pointsReturned } = result;
    await logAudit({
      action: "INVOICE_CANCELLED",
      entityType: "Invoice",
      entityId: invoiceId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { invoiceNumber: invoice.invoiceNumber, refunded, kept, pointsTakenBack, pointsReturned },
    });
    if (refund) {
      await logAudit({
        action: "REFUND_CREATED",
        entityType: "Invoice",
        entityId: invoiceId,
        userId: authResult.userId,
        userRole: authResult.role,
        salonId: authResult.salonId,
        details: {
          amount: refunded,
          reason: REFUND_REASON,
          pointsReversed: refund.pointsReversed,
          pointsTaken: refund.pointsTaken,
          pointsReturned: refund.pointsReturned,
          refundId: refund.refundId,
        },
      });
    }

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/sales");
    revalidatePath(`/dashboard/sales/${invoice.saleId}`);
    revalidatePath(`/dashboard/clients/${invoice.clientId}`);
    revalidatePath("/dashboard/products"); // stock went back up
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: { refunded, kept, pointsTakenBack, pointsReturned } };
  } catch (error) {
    if (error instanceof CancelRefusal || error instanceof RefundRefusal) {
      return { success: false, error: error.message };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { success: false, error: INVOICE_CHANGED };
    }
    console.error("Error cancelling invoice:", error);
    return { success: false, error: "Failed to cancel invoice" };
  }
}
