"use server";

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email";
import { receiptEmailHtml, invoiceEmailHtml } from "@/lib/email-templates";
import { getSettings } from "./settings";
import { formatInTz } from "@/lib/utils/timezone";
import { effectiveInvoiceStatus, formatInvoiceStatus } from "@/lib/utils/invoice-status";
import { salonOverdueCutoff } from "@/lib/invoice-overdue";
import { getSaleLoyaltySummary, type SaleLoyaltySummary } from "@/lib/sale-loyalty-summary";
import { ActionResult } from "@/lib/types";
import { logAudit } from "./audit";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/constants/payment-methods";
import { ReceiptPDF } from "@/components/sales/receipt-pdf";
import { InvoicePDF } from "@/components/invoices/invoice-pdf";
import { buildSaleInvoicePdfData, buildSaleReceiptData, NO_LOYALTY } from "@/components/sales/receipt-data";
import { safeFilename, clientFileLabel } from "@/lib/utils/filename";

/** Loyalty figures for a document, or none when the program is off or the client is a walk-in. */
async function loyaltyFor(
  sale: { id: string; client: { id: string; isWalkIn: boolean } },
  enabled: boolean
): Promise<SaleLoyaltySummary> {
  return enabled && !sale.client.isWalkIn ? getSaleLoyaltySummary(sale.id, sale.client.id) : NO_LOYALTY;
}

/**
 * Render a react-pdf document to a buffer for an email attachment. Isolated so a render failure (e.g.
 * a bad logo) still lets the HTML email go out with no attachment, rather than the customer getting
 * nothing. The cast: these components render a react-pdf <Document>; the element type is looser than
 * `renderToBuffer` wants (same as the JSX form).
 */
async function pdfAttachment(
  element: ReturnType<typeof createElement>,
  filename: string,
  label: string
): Promise<Array<{ filename: string; content: Buffer }> | undefined> {
  try {
    const content = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);
    return [{ filename, content }];
  } catch (pdfError) {
    console.error(`${label} PDF render failed; sending email without the attachment:`, pdfError);
    return undefined;
  }
}

export async function sendReceiptEmail(saleId: string): Promise<ActionResult<{ emailId: string }>> {
  const authResult = await checkAuth("sales:view");
  if (!authResult) return { success: false, error: "Unauthorized" };

  const { salonId, userId, role } = authResult;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, salonId },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, email: true, isWalkIn: true } },
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
          refundedAt: true,
          payments: { select: { method: true, amount: true } },
          refunds: { select: { amount: true } },
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
        discount: Number(item.discount),
        note: item.note ?? undefined,
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

    // Attach an A4 PDF of the same receipt so the customer gets a saveable/printable copy. A4 (not the
    // salon's thermal print size) because an email attachment is read on a screen / home printer.
    const loyalty = await loyaltyFor(sale, settings.loyaltyProgramEnabled);
    const receiptData = buildSaleReceiptData(sale, { ...settings, receiptSize: "A4" }, loyalty);
    const receiptFile = `${safeFilename(`${clientFileLabel(sale.client)} - Receipt ${sale.invoice.invoiceNumber}`)}.pdf`;
    // The builder only returns null without an invoice, which the guard above already rules out.
    const attachments = receiptData
      ? await pdfAttachment(createElement(ReceiptPDF, { data: receiptData }), receiptFile, "Receipt")
      : undefined;

    const result = await sendEmail({
      to: sale.client.email,
      subject: `Your Receipt from ${salonName} — ${sale.invoice.invoiceNumber}`,
      html,
      salonName,
      attachments,
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
      client: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, isWalkIn: true },
      },
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
          dueDate: true,
          tax: true,
          total: true,
          createdAt: true,
          payments: { select: { amount: true } },
          refunds: { select: { amount: true } },
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

    // The status to show is the DERIVED one (OVERDUE once the due date has passed), exactly as the
    // invoice page prints it — otherwise the email and the page could disagree about the same bill.
    const status = effectiveInvoiceStatus(sale.invoice.status, sale.invoice.dueDate, await salonOverdueCutoff(tz));
    const statusLabel = formatInvoiceStatus(status);

    const html = invoiceEmailHtml({
      salonName,
      salonAddress: settings.salonAddress,
      salonPhone: settings.salonPhone,
      salonEmail: settings.salonEmail,
      clientName: sale.client.firstName,
      clientEmail: sale.client.email,
      invoiceNumber: sale.invoice.invoiceNumber,
      status,
      date: formatInTz(sale.invoice.createdAt, "MMMM d, yyyy", tz),
      items: sale.items.map((item) => ({
        name: item.service?.name || item.product?.name || "Unknown",
        staff: item.staff ? `${item.staff.firstName} ${item.staff.lastName}` : undefined,
        price: Number(item.price),
        quantity: item.quantity,
        discount: Number(item.discount),
        note: item.note ?? undefined,
      })),
      subtotal: Number(sale.totalAmount),
      discount: Number(sale.discount),
      tax: Number(sale.invoice.tax),
      total: Number(sale.invoice.total),
      currencyCode: settings.currencyCode,
    });

    // Attach the formal invoice as a PDF (always A4) so the customer has a saveable/printable bill.
    const loyalty = await loyaltyFor(sale, settings.loyaltyProgramEnabled);
    const invoiceData = buildSaleInvoicePdfData(sale, settings, { loyalty, status, createdAt: sale.invoice.createdAt });
    const invoiceFile = `${safeFilename(`${clientFileLabel(sale.client)} - Invoice ${sale.invoice.invoiceNumber}`)}.pdf`;
    // The builder only returns null without an invoice, which the guard above already rules out.
    const attachments = invoiceData
      ? await pdfAttachment(createElement(InvoicePDF, { data: invoiceData }), invoiceFile, "Invoice")
      : undefined;

    const result = await sendEmail({
      to: sale.client.email,
      subject: `Invoice ${sale.invoice.invoiceNumber} — ${statusLabel}`,
      html,
      salonName,
      attachments,
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
