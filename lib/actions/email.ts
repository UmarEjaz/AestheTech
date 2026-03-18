"use server";

import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email";
import { receiptEmailHtml, invoiceEmailHtml } from "@/lib/email-templates";
import { getSettings } from "./settings";
import { formatInTz } from "@/lib/utils/timezone";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/payment-methods";
import { PaymentMethod } from "@prisma/client";

export async function sendReceiptEmail(saleId: string): Promise<ActionResult<{ emailId: string }>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) return { success: false, error: "Unauthorized" };

  const { salonId, userId, role } = authResult;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, salonId },
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

  try {
    const settingsResult = await getSettings();
    if (!settingsResult.success) {
      return { success: false, error: "Unable to load salon settings" };
    }
    const settings = settingsResult.data;
    const salonName = settings.salonName;
    const tz = settings.timezone;

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
      currencyCode: settings.currencyCode,
      paymentMethods: sale.invoice.payments.map(
        (p) => PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method
      ),
    });

    const result = await sendEmail({
      to: sale.client.email,
      subject: `Your Receipt from ${salonName} — ${sale.invoice.invoiceNumber}`,
      html,
      salonName,
    });

    await logAudit({
      action: "RECEIPT_EMAIL_SENT",
      entityType: "Sale",
      entityId: saleId,
      userId,
      userRole: role as string,
      salonId,
      details: { clientId: sale.clientId, invoiceNumber: sale.invoice.invoiceNumber },
    });

    return { success: true, data: { emailId: result?.id ?? "sent" } };
  } catch (error) {
    console.error("Failed to send receipt email:", error);
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { success: false, error: message };
  }
}

export async function sendInvoiceEmail(saleId: string): Promise<ActionResult<{ emailId: string }>> {
  const invoiceAuth = await checkAuth("invoices:view");
  if (!invoiceAuth) return { success: false, error: "Unauthorized" };

  const { salonId, userId: invoiceUserId, role: invoiceRole } = invoiceAuth;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, salonId },
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

  try {
    const settingsResult = await getSettings();
    if (!settingsResult.success) {
      return { success: false, error: "Unable to load salon settings" };
    }
    const settings = settingsResult.data;
    const salonName = settings.salonName;
    const tz = settings.timezone;

    const html = invoiceEmailHtml({
      salonName,
      salonAddress: settings.salonAddress,
      salonPhone: settings.salonPhone,
      salonEmail: settings.salonEmail,
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
      currencyCode: settings.currencyCode,
    });

    const statusLabel = sale.invoice.status.charAt(0) + sale.invoice.status.slice(1).toLowerCase();

    const result = await sendEmail({
      to: sale.client.email,
      subject: `Invoice ${sale.invoice.invoiceNumber} — ${statusLabel}`,
      html,
      salonName,
    });

    await logAudit({
      action: "INVOICE_EMAIL_SENT",
      entityType: "Sale",
      entityId: saleId,
      userId: invoiceUserId,
      userRole: invoiceRole as string,
      salonId,
      details: { clientId: sale.clientId, invoiceNumber: sale.invoice.invoiceNumber },
    });

    return { success: true, data: { emailId: result?.id ?? "sent" } };
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { success: false, error: message };
  }
}
