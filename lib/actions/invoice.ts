"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertPaymentOwner } from "@/lib/payment-guards";
import { checkAuth } from "@/lib/auth-helpers";
import { effectiveInvoiceStatus } from "@/lib/utils/invoice-status";
import {
  invoiceSearchSchema,
  addPaymentSchema,
  createRefundSchema,
  InvoiceSearchParams,
  AddPaymentInput,
  CreateRefundInput,
} from "@/lib/validations/invoice";
import { Prisma, InvoiceStatus } from "@prisma/client";
import { INVOICE_CHANGED, recordRefund, refundInvoiceInclude, RefundRefusal, refundSettings } from "@/lib/refund-core";
import { salonOverdueCutoff } from "@/lib/invoice-overdue";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { invalidateDashboardCache } from "@/lib/redis";

// Include relations for invoice list
const invoiceListInclude = Prisma.validator<Prisma.InvoiceInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      isWalkIn: true,
    },
  },
  sale: {
    select: {
      id: true,
      totalAmount: true,
      discount: true,
      finalAmount: true,
      staff: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      items: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          staff: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  },
  payments: {
    select: {
      id: true,
      amount: true,
      method: true,
      paidAt: true,
    },
    orderBy: { paidAt: "asc" },
  },
  refunds: {
    select: {
      id: true,
      amount: true,
      reason: true,
      pointsReversed: true,
      createdAt: true,
      refundedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  },
});

export type InvoiceListItem = Prisma.InvoiceGetPayload<{
  include: typeof invoiceListInclude;
}>;

// Get invoices with filters
export async function getInvoices(params: InvoiceSearchParams = {}): Promise<ActionResult<{
  invoices: InvoiceListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validatedParams = invoiceSearchSchema.safeParse(params);
  if (!validatedParams.success) {
    return { success: false, error: "Invalid search parameters" };
  }

  const { query, clientId, status, startDate, endDate, page = 1, limit = 20 } = validatedParams.data;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const skip = (safePage - 1) * safeLimit;

  // Build date filter
  let dateFilter: Prisma.DateTimeFilter | undefined;
  if (startDate || endDate) {
    dateFilter = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;
  }

  // OVERDUE is derived (not stored), so the status filter is translated:
  //  - OVERDUE        → outstanding (PENDING/PARTIALLY_PAID) with a past due date
  //  - PENDING/PART…  → that stored status, but NOT past due (else it's "overdue")
  //  - others         → exact stored status
  // "Overdue" means the due day has fully passed in the SALON timezone, so the cutoff is
  // start-of-today in the salon zone (an invoice due *today* is not overdue yet).
  const overdueCutoff = await salonOverdueCutoff();
  let statusFilter: Prisma.InvoiceWhereInput | undefined;
  if (status === "OVERDUE") {
    statusFilter = { status: { in: ["PENDING", "PARTIALLY_PAID"] }, dueDate: { lt: overdueCutoff } };
  } else if (status === "PENDING" || status === "PARTIALLY_PAID") {
    statusFilter = { status, OR: [{ dueDate: null }, { dueDate: { gte: overdueCutoff } }] };
  } else if (status) {
    statusFilter = { status };
  }

  const where: Prisma.InvoiceWhereInput = {
    salonId: authResult.salonId,
    ...(dateFilter && { createdAt: dateFilter }),
    ...(clientId && { clientId }),
    AND: [
      ...(statusFilter ? [statusFilter] : []),
      ...(query
        ? [
            {
              OR: [
                { invoiceNumber: { contains: query, mode: "insensitive" as const } },
                { client: { firstName: { contains: query, mode: "insensitive" as const } } },
                { client: { lastName: { contains: query, mode: "insensitive" as const } } },
                { client: { phone: { contains: query } } },
              ],
            },
          ]
        : []),
    ],
  };

  try {
    const [invoicesRaw, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: invoiceListInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
      }),
      prisma.invoice.count({ where }),
    ]);

    // Surface OVERDUE as the displayed status for past-due outstanding invoices.
    const invoices = invoicesRaw.map((inv) => ({
      ...inv,
      status: effectiveInvoiceStatus(inv.status, inv.dueDate, overdueCutoff),
    }));

    return {
      success: true,
      data: {
        invoices,
        total,
        page: safePage,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return { success: false, error: "Failed to fetch invoices" };
  }
}

// Get single invoice
export async function getInvoice(id: string): Promise<ActionResult<InvoiceListItem>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, salonId: authResult.salonId },
      include: invoiceListInclude,
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    return { success: true, data: { ...invoice, status: effectiveInvoiceStatus(invoice.status, invoice.dueDate, await salonOverdueCutoff()) } };
  } catch (error) {
    console.error("Error fetching invoice:", error);
    return { success: false, error: "Failed to fetch invoice" };
  }
}

// Get invoice by number
export async function getInvoiceByNumber(invoiceNumber: string): Promise<ActionResult<InvoiceListItem>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { salonId_invoiceNumber: { salonId: authResult.salonId, invoiceNumber } },
      include: invoiceListInclude,
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    return { success: true, data: { ...invoice, status: effectiveInvoiceStatus(invoice.status, invoice.dueDate, await salonOverdueCutoff()) } };
  } catch (error) {
    console.error("Error fetching invoice:", error);
    return { success: false, error: "Failed to fetch invoice" };
  }
}

// Add payment to invoice
export async function addPaymentToInvoice(data: AddPaymentInput): Promise<ActionResult<InvoiceListItem>> {
  const authResult = await checkAuth("invoices:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = addPaymentSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { invoiceId, amount, method } = validationResult.data;

  try {
    // Atomic read + validate + insert + optional status update. Serializable
    // isolation ensures two concurrent payment inserts can't both pass the
    // balance check and produce overpayment — one of them will be aborted
    // with a serialization failure (caught below).
    const result = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, salonId: authResult.salonId },
          include: { payments: true },
        });

        if (!invoice) {
          return { ok: false as const, error: "Invoice not found" };
        }
        if (invoice.status === InvoiceStatus.CANCELLED) {
          return { ok: false as const, error: "Cannot add payment to cancelled invoice" };
        }
        if (invoice.status === InvoiceStatus.PAID) {
          return { ok: false as const, error: "Invoice is already paid" };
        }

        const paidAmount = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const remaining = Number(invoice.total) - paidAmount;

        if (amount > remaining + 0.01) {
          return {
            ok: false as const,
            error: `Payment amount exceeds remaining balance of ${remaining.toFixed(2)}`,
          };
        }

        assertPaymentOwner({ invoiceId });
        await tx.payment.create({
          data: { invoiceId, amount, method },
        });

        const newPaidAmount = paidAmount + amount;
        if (newPaidAmount >= Number(invoice.total) - 0.01) {
          await tx.invoice.update({
            where: { id: invoiceId },
            data: {
              status: InvoiceStatus.PAID,
              paidAt: new Date(),
            },
          });
        } else {
          // Still a balance owing — reflect the partial-payment state (overdue is
          // derived from dueDate on read, so the stored status stays PARTIALLY_PAID).
          await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: InvoiceStatus.PARTIALLY_PAID },
          });
        }

        return { ok: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    // Fetch updated invoice
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceListInclude,
    });

    await logAudit({
      action: "PAYMENT_ADDED",
      entityType: "Invoice",
      entityId: invoiceId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { amount, method, invoiceNumber: updatedInvoice?.invoiceNumber },
    });

    revalidatePath("/dashboard/invoices");
    await invalidateDashboardCache(authResult.salonId);
    return { success: true, data: updatedInvoice! };
  } catch (error) {
    // Postgres serialization_failure (40001) is thrown by Prisma when a
    // concurrent transaction conflicts. Give the user a clear, actionable error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return {
        success: false,
        error: "Another payment was added at the same time. Please reload and try again.",
      };
    }
    console.error("Error adding payment:", error);
    return { success: false, error: "Failed to add payment" };
  }
}

// Get client's invoice history
export async function getClientInvoices(clientId: string): Promise<ActionResult<InvoiceListItem[]>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const invoicesRaw = await prisma.invoice.findMany({
      where: { clientId, salonId: authResult.salonId },
      include: invoiceListInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const overdueCutoff = await salonOverdueCutoff();
    const invoices = invoicesRaw.map((inv) => ({
      ...inv,
      status: effectiveInvoiceStatus(inv.status, inv.dueDate, overdueCutoff),
    }));

    return { success: true, data: invoices };
  } catch (error) {
    console.error("Error fetching client invoices:", error);
    return { success: false, error: "Failed to fetch client invoices" };
  }
}

// Get invoice statistics
export async function getInvoiceStats(): Promise<ActionResult<{
  totalPending: number;
  totalOverdue: number;
  pendingCount: number;
  overdueCount: number;
}>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Outstanding = anything still owing. Overdue is derived from the due date.
    // Amounts are the remaining balance (total − payments), not the full total.
    const outstanding = await prisma.invoice.findMany({
      where: {
        salonId: authResult.salonId,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] },
      },
      select: { total: true, dueDate: true, payments: { select: { amount: true } } },
    });

    const overdueCutoff = await salonOverdueCutoff();
    let totalPending = 0;
    let totalOverdue = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    for (const inv of outstanding) {
      const paid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const due = Math.max(0, Number(inv.total) - paid);
      const overdue = inv.dueDate != null && inv.dueDate < overdueCutoff;
      if (overdue) {
        totalOverdue += due;
        overdueCount += 1;
      } else {
        totalPending += due;
        pendingCount += 1;
      }
    }

    return {
      success: true,
      data: { totalPending, totalOverdue, pendingCount, overdueCount },
    };
  } catch (error) {
    console.error("Error fetching invoice stats:", error);
    return { success: false, error: "Failed to fetch invoice statistics" };
  }
}

// Create refund for an invoice
export async function createRefund(data: CreateRefundInput): Promise<ActionResult<{
  refundId: string;
  pointsReversed: number; // the refund's share of the bill's points
  pointsTaken: number; // what actually came off the client's balance (less if they had spent some)
  pointsReturned: number; // on a full refund, points the client had spent on the bill, given back
}>> {
  const authResult = await checkAuth("invoices:refund");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = createRefundSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { invoiceId, amount, reason } = validationResult.data;

  try {
    // Fetch settings outside transaction since they're static configuration
    const { thresholds, currencyCode } = await refundSettings();

    // Execute transaction with Serializable isolation to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, salonId: authResult.salonId },
        include: refundInvoiceInclude,
      });

      if (!invoice) {
        throw new RefundRefusal("Invoice not found");
      }

      if (invoice.status !== InvoiceStatus.PAID) {
        throw new RefundRefusal("Only paid invoices can be refunded");
      }

      const refund = await recordRefund(tx, {
        invoice,
        amount,
        reason,
        userId: authResult.userId,
        salonId: authResult.salonId,
        thresholds,
        currencyCode,
      });

      // Update invoice status if fully refunded
      if (refund.isFullRefund) {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.REFUNDED, refundedAt: new Date() },
        });
      }

      return { refund, saleId: invoice.saleId, clientId: invoice.sale.clientId };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    const { refund, saleId, clientId } = result;

    await logAudit({
      action: "REFUND_CREATED",
      entityType: "Invoice",
      entityId: invoiceId,
      userId: authResult.userId,
      userRole: authResult.role,
      salonId: authResult.salonId,
      details: { amount, reason, pointsReversed: refund.pointsReversed, pointsReturned: refund.pointsReturned, refundId: refund.refundId },
    });

    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/sales");
    revalidatePath(`/dashboard/sales/${saleId}`);
    revalidatePath(`/dashboard/clients/${clientId}`);
    if (refund.isFullRefund) revalidatePath("/dashboard/products"); // stock went back up
    await invalidateDashboardCache(authResult.salonId);

    const { refundId, pointsReversed, pointsTaken, pointsReturned } = refund;
    return { success: true, data: { refundId, pointsReversed, pointsTaken, pointsReturned } };
  } catch (error) {
    // Only refusals the person can act on are shown as-is; database errors stay generic.
    if (error instanceof RefundRefusal) {
      return { success: false, error: error.message };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { success: false, error: INVOICE_CHANGED };
    }
    console.error("Error creating refund:", error);
    return { success: false, error: "Failed to create refund" };
  }
}
