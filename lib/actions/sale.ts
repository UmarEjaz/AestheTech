"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, Permission } from "@/lib/permissions";
import {
  createSaleSchema,
  completeSaleSchema,
  saleSearchSchema,
  CreateSaleInput,
  CompleteSaleInput,
  SaleSearchParams,
} from "@/lib/validations/sale";
import { Role, Prisma, PaymentMethod, InvoiceStatus } from "@prisma/client";
import { getSettings } from "./settings";

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

// Include relations for sale list
const saleListInclude = Prisma.validator<Prisma.SaleInclude>()({
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
    },
  },
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
          duration: true,
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
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
    },
  },
});

export type SaleListItem = Prisma.SaleGetPayload<{
  include: typeof saleListInclude;
}>;

// Generate invoice number
async function generateInvoiceNumber(): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");

  // Get count of invoices this month
  const startOfMonth = new Date(year, today.getMonth(), 1);
  const endOfMonth = new Date(year, today.getMonth() + 1, 0, 23, 59, 59, 999);

  const count = await prisma.invoice.count({
    where: {
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
  });

  const sequence = String(count + 1).padStart(4, "0");
  return `INV-${year}${month}-${sequence}`;
}

// Get sales with filters
export async function getSales(params: SaleSearchParams = {}): Promise<ActionResult<{
  sales: SaleListItem[];
  total: number;
  page: number;
  totalPages: number;
}>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validatedParams = saleSearchSchema.safeParse(params);
  if (!validatedParams.success) {
    return { success: false, error: "Invalid search parameters" };
  }

  const { query, clientId, staffId, startDate, endDate, page = 1, limit = 20 } = validatedParams.data;
  const skip = (page - 1) * limit;

  // Build date filter
  let dateFilter: Prisma.DateTimeFilter | undefined;
  if (startDate || endDate) {
    dateFilter = {};
    if (startDate) dateFilter.gte = startDate;
    if (endDate) dateFilter.lte = endDate;
  }

  const where: Prisma.SaleWhereInput = {
    ...(dateFilter && { createdAt: dateFilter }),
    ...(clientId && { clientId }),
    ...(staffId && { staffId }),
    ...(query && {
      OR: [
        { client: { firstName: { contains: query, mode: "insensitive" } } },
        { client: { lastName: { contains: query, mode: "insensitive" } } },
        { client: { phone: { contains: query } } },
        { invoice: { invoiceNumber: { contains: query, mode: "insensitive" } } },
      ],
    }),
  };

  try {
    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: saleListInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    return {
      success: true,
      data: {
        sales,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching sales:", error);
    return { success: false, error: "Failed to fetch sales" };
  }
}

// Get single sale
export async function getSale(id: string): Promise<ActionResult<SaleListItem>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: saleListInclude,
    });

    if (!sale) {
      return { success: false, error: "Sale not found" };
    }

    return { success: true, data: sale };
  } catch (error) {
    console.error("Error fetching sale:", error);
    return { success: false, error: "Failed to fetch sale" };
  }
}

// Create a new sale (draft)
export async function createSale(data: CreateSaleInput): Promise<ActionResult<SaleListItem>> {
  const authResult = await checkAuth("sales:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = createSaleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { clientId, items, discount, discountType } = validationResult.data;

  try {
    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { isActive: true },
    });

    if (!client || !client.isActive) {
      return { success: false, error: "Client not found or inactive" };
    }

    // Verify services and calculate totals
    const serviceIds = items.map((item) => item.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, price: true, isActive: true },
    });

    const serviceMap = new Map(services.map((s) => [s.id, s]));

    // Validate all services exist and are active
    for (const item of items) {
      const service = serviceMap.get(item.serviceId);
      if (!service) {
        return { success: false, error: `Service not found: ${item.serviceId}` };
      }
      if (!service.isActive) {
        return { success: false, error: "One or more services are not available" };
      }
    }

    // Calculate total
    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.price * item.quantity;
    }

    // Apply discount
    let discountAmount = discount;
    if (discountType === "percentage") {
      discountAmount = (totalAmount * discount) / 100;
    }

    const finalAmount = Math.max(0, totalAmount - discountAmount);

    // Create sale with items
    const sale = await prisma.sale.create({
      data: {
        clientId,
        staffId: authResult.userId,
        totalAmount,
        discount: discountAmount,
        finalAmount,
        items: {
          create: items.map((item) => ({
            serviceId: item.serviceId,
            staffId: item.staffId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: saleListInclude,
    });

    revalidatePath("/dashboard/sales");
    return { success: true, data: sale };
  } catch (error) {
    console.error("Error creating sale:", error);
    return { success: false, error: "Failed to create sale" };
  }
}

// Complete sale with payment and generate invoice
export async function completeSale(data: CompleteSaleInput): Promise<ActionResult<{
  sale: SaleListItem;
  invoiceNumber: string;
  pointsEarned: number;
}>> {
  const authResult = await checkAuth("sales:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  const validationResult = completeSaleSchema.safeParse(data);
  if (!validationResult.success) {
    return { success: false, error: validationResult.error.issues[0].message };
  }

  const { saleId, payments, redeemPoints } = validationResult.data;

  try {
    // Get the sale
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        invoice: true,
        client: {
          include: { loyaltyPoints: true },
        },
        items: {
          include: { service: { select: { points: true } } },
        },
      },
    });

    if (!sale) {
      return { success: false, error: "Sale not found" };
    }

    if (sale.invoice) {
      return { success: false, error: "Sale already has an invoice" };
    }

    // Validate points redemption
    if (redeemPoints > 0) {
      const clientPoints = sale.client.loyaltyPoints?.balance || 0;
      if (redeemPoints > clientPoints) {
        return { success: false, error: "Insufficient loyalty points" };
      }
    }

    // Get settings for tax rate
    const settingsResult = await getSettings();
    const taxRate = settingsResult.success ? settingsResult.data.taxRate : 0;
    const loyaltyPointsPerDollar = settingsResult.success ? settingsResult.data.loyaltyPointsPerDollar : 1;

    // Calculate amounts
    const pointsValue = redeemPoints / 100; // 100 points = $1
    const amountAfterPoints = Number(sale.finalAmount) - pointsValue;
    const tax = (amountAfterPoints * taxRate) / 100;
    const totalWithTax = amountAfterPoints + tax;

    // Validate payment total
    const paymentTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    if (Math.abs(paymentTotal - totalWithTax) > 0.01) {
      return {
        success: false,
        error: `Payment total (${paymentTotal.toFixed(2)}) doesn't match invoice total (${totalWithTax.toFixed(2)})`
      };
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Calculate points earned from this sale
    let pointsEarned = 0;
    for (const item of sale.items) {
      pointsEarned += (item.service.points || 0) * item.quantity;
    }
    // Also add points based on amount spent
    pointsEarned += Math.floor(Number(sale.finalAmount) * loyaltyPointsPerDollar);

    // Execute transaction
    await prisma.$transaction(async (tx) => {
      // Create invoice
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          saleId,
          clientId: sale.clientId,
          amount: amountAfterPoints,
          tax,
          total: totalWithTax,
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });

      // Create payments
      for (const payment of payments) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: payment.amount,
            method: payment.method,
          },
        });
      }

      // Handle loyalty points
      const existingPoints = await tx.loyaltyPoints.findUnique({
        where: { clientId: sale.clientId },
      });

      if (existingPoints) {
        // Deduct redeemed points and add earned points
        const newBalance = existingPoints.balance - redeemPoints + pointsEarned;

        // Update tier based on new balance
        let newTier = existingPoints.tier;
        if (newBalance >= 1000) newTier = "PLATINUM";
        else if (newBalance >= 500) newTier = "GOLD";
        else newTier = "SILVER";

        await tx.loyaltyPoints.update({
          where: { clientId: sale.clientId },
          data: { balance: newBalance, tier: newTier },
        });
      } else {
        // Create loyalty points record
        let tier: "SILVER" | "GOLD" | "PLATINUM" = "SILVER";
        if (pointsEarned >= 1000) tier = "PLATINUM";
        else if (pointsEarned >= 500) tier = "GOLD";

        await tx.loyaltyPoints.create({
          data: {
            clientId: sale.clientId,
            balance: pointsEarned,
            tier,
          },
        });
      }

      // Record loyalty transactions
      if (redeemPoints > 0) {
        await tx.loyaltyTransaction.create({
          data: {
            clientId: sale.clientId,
            saleId,
            points: -redeemPoints,
            type: "REDEEMED",
            description: `Redeemed for sale ${invoiceNumber}`,
          },
        });
      }

      if (pointsEarned > 0) {
        await tx.loyaltyTransaction.create({
          data: {
            clientId: sale.clientId,
            saleId,
            points: pointsEarned,
            type: "EARNED",
            description: `Earned from sale ${invoiceNumber}`,
          },
        });
      }
    });

    // Fetch updated sale
    const updatedSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: saleListInclude,
    });

    revalidatePath("/dashboard/sales");
    revalidatePath("/dashboard/invoices");
    revalidatePath(`/dashboard/clients/${sale.clientId}`);

    return {
      success: true,
      data: {
        sale: updatedSale!,
        invoiceNumber,
        pointsEarned,
      },
    };
  } catch (error) {
    console.error("Error completing sale:", error);
    return { success: false, error: "Failed to complete sale" };
  }
}

// Quick sale - create and complete in one step
export async function quickSale(data: CreateSaleInput & {
  payments: { method: PaymentMethod; amount: number }[];
  redeemPoints?: number;
}): Promise<ActionResult<{
  sale: SaleListItem;
  invoiceNumber: string;
  pointsEarned: number;
}>> {
  const authResult = await checkAuth("sales:create");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // First create the sale
  const createResult = await createSale(data);
  if (!createResult.success) {
    return createResult;
  }

  // Then complete it
  return completeSale({
    saleId: createResult.data.id,
    payments: data.payments,
    redeemPoints: data.redeemPoints || 0,
  });
}

// Delete sale (only if no invoice)
export async function deleteSale(id: string): Promise<ActionResult<void>> {
  const authResult = await checkAuth("sales:delete");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { invoice: true },
    });

    if (!sale) {
      return { success: false, error: "Sale not found" };
    }

    if (sale.invoice) {
      return { success: false, error: "Cannot delete a sale with an invoice" };
    }

    await prisma.sale.delete({ where: { id } });

    revalidatePath("/dashboard/sales");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error deleting sale:", error);
    return { success: false, error: "Failed to delete sale" };
  }
}

// Get today's sales summary
export async function getTodaysSalesSummary(): Promise<ActionResult<{
  count: number;
  revenue: number;
  averageTicket: number;
}>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sales = await prisma.sale.findMany({
      where: {
        createdAt: { gte: today, lt: tomorrow },
        invoice: { isNot: null },
      },
      select: { finalAmount: true },
    });

    const count = sales.length;
    const revenue = sales.reduce((sum, s) => sum + Number(s.finalAmount), 0);
    const averageTicket = count > 0 ? revenue / count : 0;

    return {
      success: true,
      data: { count, revenue, averageTicket },
    };
  } catch (error) {
    console.error("Error fetching today's sales:", error);
    return { success: false, error: "Failed to fetch sales summary" };
  }
}

// Get client's purchase history
export async function getClientSales(clientId: string): Promise<ActionResult<SaleListItem[]>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const sales = await prisma.sale.findMany({
      where: { clientId },
      include: saleListInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return { success: true, data: sales };
  } catch (error) {
    console.error("Error fetching client sales:", error);
    return { success: false, error: "Failed to fetch client sales" };
  }
}
