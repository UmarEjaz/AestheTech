"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { Role } from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { receiptEmailHtml, invoiceEmailHtml } from "@/lib/email-templates";
import { getSettings } from "./settings";
import { formatInTz } from "@/lib/utils/timezone";
import { ActionResult } from "@/lib/types";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/payment-methods";
import { PaymentMethod } from "@prisma/client";

export async function sendReceiptEmail(saleId: string): Promise<ActionResult<{ emailId: string }>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const role = session.user.role as Role;
  if (!hasPermission(role, "sales:view")) {
    return { success: false, error: "Unauthorized" };
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      client: { select: { firstName: true, lastName: true, email: true } },
      items: {
        include: {
          service: { select: { name: true } },
          staff: { select: { firstName: true, lastName: true } },
          product: { select: { name: true } },
        },
      },
      invoice: {
        select: {
          invoiceNumber: true,
          tax: true,
          total: true,
          payments: { select: { method: true } },
        },
      },
    },
  });

  if (!sale) return { success: false, error: "Sale not found" };
  if (!sale.invoice) return { success: false, error: "Sale has no invoice" };
  if (!sale.client.email) return { success: false, error: "Client has no email address" };

  const settingsResult = await getSettings();
  const settings = settingsResult.success ? settingsResult.data : null;
  const currencySymbol = settings?.currencySymbol ?? "$";
  const salonName = settings?.salonName ?? "AestheTech Salon";
  const tz = settings?.timezone ?? "UTC";

  const html = receiptEmailHtml({
    salonName,
    clientName: sale.client.firstName,
    invoiceNumber: sale.invoice.invoiceNumber,
    date: formatInTz(sale.createdAt, "MMMM d, yyyy", tz),
    items: sale.items.map((item) => ({
      name: item.service?.name || item.product?.name || "Unknown",
      staff: item.staff ? `${item.staff.firstName} ${item.staff.lastName}` : undefined,
      price: Number(item.price),
      quantity: item.quantity,
    })),
    subtotal: Number(sale.totalAmount),
    discount: Number(sale.discount),
    tax: Number(sale.invoice.tax),
    total: Number(sale.invoice.total),
    currencySymbol,
    paymentMethods: sale.invoice.payments.map(
      (p) => PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method
    ),
  });

  try {
    const result = await sendEmail({
      to: sale.client.email,
      subject: `Your Receipt from ${salonName} — ${sale.invoice.invoiceNumber}`,
      html,
      salonName,
    });

    return { success: true, data: { emailId: result?.id ?? "sent" } };
  } catch (error) {
    console.error("Failed to send receipt email:", error);
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { success: false, error: message };
  }
}

export async function sendInvoiceEmail(saleId: string): Promise<ActionResult<{ emailId: string }>> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const role = session.user.role as Role;
  if (!hasPermission(role, "invoices:view")) {
    return { success: false, error: "Unauthorized" };
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      client: { select: { firstName: true, lastName: true, email: true } },
      items: {
        include: {
          service: { select: { name: true } },
          staff: { select: { firstName: true, lastName: true } },
          product: { select: { name: true } },
        },
      },
      invoice: {
        select: {
          invoiceNumber: true,
          status: true,
          tax: true,
          total: true,
          createdAt: true,
        },
      },
    },
  });

  if (!sale) return { success: false, error: "Sale not found" };
  if (!sale.invoice) return { success: false, error: "Sale has no invoice" };
  if (!sale.client.email) return { success: false, error: "Client has no email address" };

  const settingsResult = await getSettings();
  const settings = settingsResult.success ? settingsResult.data : null;
  const currencySymbol = settings?.currencySymbol ?? "$";
  const salonName = settings?.salonName ?? "AestheTech Salon";
  const tz = settings?.timezone ?? "UTC";

  const html = invoiceEmailHtml({
    salonName,
    salonAddress: settings?.salonAddress,
    salonPhone: settings?.salonPhone,
    salonEmail: settings?.salonEmail,
    clientName: sale.client.firstName,
    clientEmail: sale.client.email,
    invoiceNumber: sale.invoice.invoiceNumber,
    status: sale.invoice.status,
    date: formatInTz(sale.invoice.createdAt, "MMMM d, yyyy", tz),
    items: sale.items.map((item) => ({
      name: item.service?.name || item.product?.name || "Unknown",
      staff: item.staff ? `${item.staff.firstName} ${item.staff.lastName}` : undefined,
      price: Number(item.price),
      quantity: item.quantity,
    })),
    subtotal: Number(sale.totalAmount),
    discount: Number(sale.discount),
    tax: Number(sale.invoice.tax),
    total: Number(sale.invoice.total),
    currencySymbol,
  });

  const statusLabel = sale.invoice.status.charAt(0) + sale.invoice.status.slice(1).toLowerCase();

  try {
    const result = await sendEmail({
      to: sale.client.email,
      subject: `Invoice ${sale.invoice.invoiceNumber} — ${statusLabel}`,
      html,
      salonName,
    });

    return { success: true, data: { emailId: result?.id ?? "sent" } };
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { success: false, error: message };
  }
}
