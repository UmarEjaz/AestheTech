// The Reports page's money breakdowns (by item, by staff member, by client), built from "lines": one
// per item sold in the period, plus one (negative) per item on each refund or cancellation made in the
// period, so those come off the breakdowns on the day they happen, as they do off total revenue.

/** One sold item's contribution, or (negative) a refund's or cancellation's share of one. */
export interface ReportLine {
  item: { key: string; name: string };
  staff: { key: string; name: string } | null;
  client: { key: string; name: string };
  saleId: string | null; // set on the sale itself; a refund or cancellation is not another sale
  revenue: number;
  cost: number;
}

/** What a line needs from a sale item. */
export interface LineSource {
  id: string;
  service: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string } | null;
}

/** Build a line, keyed by item (service or product), staff member and client. */
export function reportLine(
  source: LineSource,
  client: { key: string; name: string },
  saleId: string | null,
  revenue: number,
  cost: number
): ReportLine {
  const item = source.service
    ? { key: `svc:${source.service.id}`, name: source.service.name }
    : source.product
      ? { key: `prod:${source.product.id}`, name: source.product.name }
      : { key: `unknown:${source.id}`, name: "Unknown" };
  const staff = source.staff
    ? { key: source.staff.id, name: `${source.staff.firstName} ${source.staff.lastName}` }
    : null;
  return { item, staff, client, saleId, revenue, cost };
}

interface Totals {
  name: string;
  revenue: number;
  cost: number;
  sales: Set<string>;
  saleLines: number; // items sold (not refund or cancellation lines)
}

/** Sum the lines per key, keeping the first name seen. */
function totalsBy(lines: ReportLine[], keyOf: (l: ReportLine) => { key: string; name: string } | null): Totals[] {
  const map = new Map<string, Totals>();
  for (const line of lines) {
    const k = keyOf(line);
    if (!k) continue;
    const t = map.get(k.key) ?? { name: k.name, revenue: 0, cost: 0, sales: new Set<string>(), saleLines: 0 };
    t.revenue += line.revenue;
    t.cost += line.cost;
    if (line.saleId) {
      t.sales.add(line.saleId);
      t.saleLines += 1;
    }
    map.set(k.key, t);
  }
  return [...map.values()];
}

const marginOf = (revenue: number, profit: number): number =>
  revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;

export interface ItemRevenue {
  item: string;
  revenue: number;
  percentage: number;
  cost?: number;
  profit?: number;
  margin?: number;
}

/** The top 10 services and products by revenue, with each one's share (and profit, if allowed). */
export function revenueByItem(lines: ReportLine[], withProfit: boolean): ItemRevenue[] {
  const totals = totalsBy(lines, (l) => l.item);
  const all = totals.reduce((sum, t) => sum + t.revenue, 0);
  return totals
    .map((t) => ({
      item: t.name,
      revenue: t.revenue,
      percentage: all > 0 ? Math.round((t.revenue / all) * 100) : 0,
      ...(withProfit && { cost: t.cost, profit: t.revenue - t.cost, margin: marginOf(t.revenue, t.revenue - t.cost) }),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

export interface StaffRevenue {
  staff: string;
  revenue: number;
  appointments: number;
  cost?: number;
  profit?: number;
}

/** Revenue per staff member (items with no staff member, e.g. a product, are left out). */
export function revenueByStaff(lines: ReportLine[], withProfit: boolean): StaffRevenue[] {
  return totalsBy(lines, (l) => l.staff)
    .map((t) => ({
      staff: t.name,
      revenue: t.revenue,
      appointments: t.saleLines, // items sold in the period, as before (a count, not money)
      ...(withProfit && { cost: t.cost, profit: t.revenue - t.cost }),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface ClientProfit {
  client: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  salesCount: number;
}

/** Profit per client, most profitable first. */
export function profitByClient(lines: ReportLine[]): ClientProfit[] {
  return totalsBy(lines, (l) => l.client)
    .map((t) => ({
      client: t.name,
      revenue: t.revenue,
      cost: t.cost,
      profit: t.revenue - t.cost,
      margin: marginOf(t.revenue, t.revenue - t.cost),
      salesCount: t.sales.size,
    }))
    .sort((a, b) => b.profit - a.profit);
}
