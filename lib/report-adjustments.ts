import "server-only";
import { InvoiceStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { billAdjustments, type Adjustment, type AdjustableItem } from "@/lib/utils/revenue-adjustments";

/** A sold item with what the reports group revenue by. */
export interface ReportItem extends AdjustableItem {
  id: string;
  serviceId: string | null;
  staffId: string | null;
  service: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string } | null;
}

export type ReportAdjustment = Adjustment<ReportItem>;

/** A date range as the callers' own queries write it: `lt` (dashboard) or `lte` (reports). */
export type DateRange = { gte: Date; lt: Date } | { gte: Date; lte: Date };

const within = (at: Date, range: DateRange): boolean =>
  at >= range.gte && ("lt" in range ? at < range.lt : at <= range.lte);

const adjustableInvoiceSelect = {
  amount: true, // the sale's final amount less what was paid with points (before tax)
  total: true,
  cancelledAt: true,
  payments: { select: { amount: true } },
  refunds: { select: { amount: true, createdAt: true } },
  sale: {
    select: {
      finalAmount: true,
      clientId: true,
      client: { select: { firstName: true, lastName: true } },
      items: {
        select: {
          id: true,
          price: true,
          quantity: true,
          costAtSale: true,
          serviceId: true,
          productId: true,
          staffId: true,
          service: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

/**
 * Every refund and cancellation made in `range` at these salons, as revenue adjustments dated the day
 * they happened (see lib/utils/revenue-adjustments.ts). Only bills with such an event are loaded, so
 * this stays small however many sales the range holds.
 */
export async function loadRevenueAdjustments(salonIds: string[], range: DateRange): Promise<ReportAdjustment[]> {
  const [refunded, cancelled] = await Promise.all([
    prisma.refund.findMany({
      where: { salonId: { in: salonIds }, createdAt: range },
      select: { invoiceId: true },
    }),
    prisma.invoice.findMany({
      where: { salonId: { in: salonIds }, status: InvoiceStatus.CANCELLED, cancelledAt: range },
      select: { id: true },
    }),
  ]);
  const ids = [...new Set([...refunded.map((r) => r.invoiceId), ...cancelled.map((c) => c.id)])];
  if (ids.length === 0) return [];

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids }, salonId: { in: salonIds } },
    select: adjustableInvoiceSelect,
  });
  return invoices.flatMap((inv) =>
    billAdjustments<ReportItem>({
      total: Number(inv.total),
      revenue: Number(inv.sale.finalAmount),
      pointsValue: Math.max(0, Number(inv.sale.finalAmount) - Number(inv.amount)),
      paid: inv.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      cancelledAt: inv.cancelledAt,
      refunds: inv.refunds.map((r) => ({ amount: Number(r.amount), createdAt: r.createdAt })),
      items: inv.sale.items.map((item) => ({
        ...item,
        price: Number(item.price),
        costAtSale: item.costAtSale == null ? null : Number(item.costAtSale),
      })),
      clientId: inv.sale.clientId,
      clientName: `${inv.sale.client.firstName} ${inv.sale.client.lastName || ""}`.trim(),
    }).filter((a) => within(a.at, range))
  );
}
