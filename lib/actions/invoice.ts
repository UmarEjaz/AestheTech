"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import {
  invoiceSearchSchema,
  addPaymentSchema,
  updateInvoiceStatusSchema,
  InvoiceSearchParams,
  AddPaymentInput,
  UpdateInvoiceStatusInput,
} from "@/lib/validations/invoice";
import { Role, Prisma, InvoiceStatus } from "@prisma/client";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function checkAuth(permission: Permission): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = session.user.role as Role;
  if (!hasPermission(role, permission)) {
    return null;
  }

  return { userId: session.user.id, role };
}

// Include relations for invoice list
const invoiceListInclude = Prisma.validator<Prisma.InvoiceInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
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
  const skip = (page - 1) * limit;

  // Build date filter
  let dateFilter: Prisma.DateTimeFilter | undefined;
  if (startDate || endDate) {
    dateFilter = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;
  }

  const where: Prisma.InvoiceWhereInput = {
    ...(dateFilter && { createdAt: dateFilter }),
    ...(clientId && { clientId }),
    ...(status && { status }),
    ...(query && {
      OR: [
        { invoiceNumber: { contains: query, mode: "insensitive" } },
        { client: { firstName: { contains: query, mode: "insensitive" } } },
        { client: { lastName: { contains: query, mode: "insensitive" } } },
        { client: { phone: { contains: query } } },
      ],
    }),
  };

  try {
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: invoiceListInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      success: true,
      data: {
        invoices,
        total,
        page,
        totalPages: Math.ceil(total / limit),
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
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: invoiceListInclude,
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    return { success: true, data: invoice };
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
      where: { invoiceNumber },
      include: invoiceListInclude,
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    return { success: true, data: invoice };
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
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      return { success: false, error: "Cannot add payment to cancelled invoice" };
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return { success: false, error: "Invoice is already paid" };
    }

    // Calculate remaining amount
    const paidAmount = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Number(invoice.total) - paidAmount;

    if (amount > remaining + 0.01) {
      return { success: false, error: `Payment amount exceeds remaining balance of ${remaining.toFixed(2)}` };
    }

    // Add payment
    await prisma.payment.create({
      data: {
        invoiceId,
        amount,
        method,
      },
    });

    // Check if invoice is now fully paid
    const newPaidAmount = paidAmount + amount;
    if (newPaidAmount >= Number(invoice.total) - 0.01) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });
    }

    // Fetch updated invoice
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceListInclude,
    });

    revalidatePath("/dashboard/invoices");
    return { success: true, data: updatedInvoice! };
  } catch (error) {
    console.error("Error adding payment:", error);
    return { success: false, error: "Failed to add payment" };
  }
}

// Update invoice status
export async function updateInvoiceStatus(
  id: string,
  data: UpdateInvoiceStatusInput
): Promise<ActionResult<InvoiceListItem>> {
  const authResult = await checkAuth("invoices:update");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = updateInvoiceStatusSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    // Validate status transitions
    const validTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
      PENDING: [InvoiceStatus.PAID, InvoiceStatus.OVERDUE, InvoiceStatus.CANCELLED],
      OVERDUE: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
      PAID: [], // Cannot change from paid
      CANCELLED: [], // Cannot change from cancelled
    };

    const allowedStatuses = validTransitions[invoice.status];
    if (!allowedStatuses.includes(validationResult.data.status)) {
      return {
        success: false,
        error: `Cannot change status from ${invoice.status} to ${validationResult.data.status}`,
      };
    }

    const updateData: Prisma.InvoiceUpdateInput = {
      status: validationResult.data.status,
    };

    if (validationResult.data.status === InvoiceStatus.PAID) {
      updateData.paidAt = new Date();
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: invoiceListInclude,
    });

    revalidatePath("/dashboard/invoices");
    return { success: true, data: updatedInvoice };
  } catch (error) {
    console.error("Error updating invoice status:", error);
    return { success: false, error: "Failed to update invoice status" };
  }
}

// Cancel invoice
export async function cancelInvoice(id: string): Promise<ActionResult<InvoiceListItem>> {
  const authResult = await checkAuth("invoices:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return { success: false, error: "Cannot cancel a paid invoice" };
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      return { success: false, error: "Invoice is already cancelled" };
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
      include: invoiceListInclude,
    });

    revalidatePath("/dashboard/invoices");
    return { success: true, data: updatedInvoice };
  } catch (error) {
    console.error("Error cancelling invoice:", error);
    return { success: false, error: "Failed to cancel invoice" };
  }
}

// Get client's invoice history
export async function getClientInvoices(clientId: string): Promise<ActionResult<InvoiceListItem[]>> {
  const authResult = await checkAuth("invoices:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const invoices = await prisma.invoice.findMany({
      where: { clientId },
      include: invoiceListInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });

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
    const [pendingInvoices, overdueInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: InvoiceStatus.PENDING },
        select: { total: true },
      }),
      prisma.invoice.findMany({
        where: { status: InvoiceStatus.OVERDUE },
        select: { total: true },
      }),
    ]);

    return {
      success: true,
      data: {
        totalPending: pendingInvoices.reduce((sum, i) => sum + Number(i.total), 0),
        totalOverdue: overdueInvoices.reduce((sum, i) => sum + Number(i.total), 0),
        pendingCount: pendingInvoices.length,
        overdueCount: overdueInvoices.length,
      },
    };
  } catch (error) {
    console.error("Error fetching invoice stats:", error);
    return { success: false, error: "Failed to fetch invoice statistics" };
  }
}
