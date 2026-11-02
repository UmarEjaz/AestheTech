"use server";

import { prisma } from "@/lib/prisma";
import { checkAuthBasic } from "@/lib/auth-helpers";
import { hasPermission } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { getSettings } from "./settings";
import { toSalonTz, formatInTz } from "@/lib/utils/timezone";
import { ActionResult } from "@/lib/types";
import { cacheGet, cacheSet } from "@/lib/redis";
import { getOrganizationSalonIds, getOrgRootSalonId } from "./branch";
import { isModuleEnabled } from "./modules";
import { loadRevenueAdjustments, type ReportAdjustment } from "@/lib/report-adjustments";
import { costChange, itemChanges, revenueChange, sumOf } from "@/lib/utils/revenue-adjustments";
import {
  profitByClient as profitByClientOf,
  reportLine,
  revenueByItem as revenueByItemOf,
  revenueByStaff as revenueByStaffOf,
  type ReportLine,
} from "@/lib/utils/report-breakdowns";

// Reports data
export interface ReportData {
  // Money-bearing arrays are optional. Server omits them when the caller lacks
  // `reports:financial`. UI must check `capabilities.includes("reports:financial")`
  // and either hide those sections or render an "access denied" placeholder —
  // never fall back to `?? 0`/`?? []` which would silently lie ("revenue is $0").
  revenueByDay?: { date: string; revenue: number; salesCount: number; expenses: number; cost?: number; profit?: number }[];
  revenueByItem?: { item: string; revenue: number; percentage: number; cost?: number; profit?: number; margin?: number }[];
  revenueByStaff?: { staff: string; revenue: number; appointments: number; cost?: number; profit?: number }[];
  profitByClient?: { client: string; revenue: number; cost: number; profit: number; margin: number; salesCount: number }[];
  appointmentsByStatus: { status: string; count: number }[];
  clientGrowth: { date: string; newClients: number; totalClients: number }[];
  peakHours: { hour: number; count: number }[];
  expensesByCategory?: { category: string; color: string; amount: number }[];
  totals: {
    revenue?: number;
    sales: number;
    appointments: number;
    newClients: number;
    expenses?: number;
    cost?: number;
    grossProfit?: number;
    profitMargin?: number;
    netProfit?: number;
  };
  hasMissingCosts?: boolean;
  capabilities: string[];
  currencyCode: string;
}

export async function getReportData(params: {
  startDate: Date;
  endDate: Date;
  branchFilter?: "current" | "all";
}): Promise<ActionResult<ReportData>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  // Module gate: Reports must be enabled for this salon (effective super admin
  // "Enter salon" bypasses). checkAuthBasic skips the checkAuth module-fold, so
  // enforce it explicitly here before any permission/data work.
  if (!authResult.isSuperAdmin && !(await isModuleEnabled(authResult.salonId, "reports"))) {
    return { success: false, error: "Reports is not enabled for this salon." };
  }

  if (!(await hasPermission(authResult.roleId, "reports:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId))) {
    return { success: false, error: "You don't have permission to view reports" };
  }

  const { startDate, endDate, branchFilter = "current" } = params;
  const canViewAllBranches = await hasPermission(authResult.roleId, "data:all-branches", authResult.isSuperAdmin, authResult.salonId, authResult.userId);

  // `reports:financial` gates monetary fields (revenue, expenses, profit, etc.).
  // A user with `reports:view` but not `reports:financial` still sees operational
  // sections (appointments, client growth, peak hours) but with money fields redacted.
  const canViewFinancial = await hasPermission(
    authResult.roleId,
    "reports:financial",
    authResult.isSuperAdmin,
    authResult.salonId,
    authResult.userId
  );

  try {
    // Determine which salon IDs to query (only users with data:all-branches can view across all branches)
    let salonIds: string[];
    if (branchFilter === "all" && canViewAllBranches) {
      salonIds = await getOrganizationSalonIds(authResult.salonId);
    } else {
      salonIds = [authResult.salonId];
    }
    const salonFilter = { in: salonIds };

    // Get settings for currency and timezone
    const settingsResult = await getSettings();
    const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";
    const tz = settingsResult.success ? settingsResult.data.timezone : "UTC";
    const canViewProfit = await hasPermission(authResult.roleId, "profit:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId);

    // Check cache — use org root ID for org-wide queries so invalidation works correctly.
    // `fin=${canViewFinancial}` separates cache entries for users with vs. without financial
    // access so a financial-view user doesn't get served a redacted cached payload (or vice versa).
    let cacheKey: string;
    if (branchFilter === "all" && canViewAllBranches) {
      const orgRootId = await getOrgRootSalonId(authResult.salonId);
      cacheKey = `org:${orgRootId}:reports:${tz}:${currencyCode}:pft=${canViewProfit}:fin=${canViewFinancial}:${startDate.toISOString()}:${endDate.toISOString()}`;
    } else {
      cacheKey = `salon:${authResult.salonId}:reports:${tz}:${currencyCode}:pft=${canViewProfit}:fin=${canViewFinancial}:${startDate.toISOString()}:${endDate.toISOString()}`;
    }
    const cached = await cacheGet<ReportData>(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    // Fetch all report data in parallel. Money-bearing queries (sale, saleItem, expense
     // full rows) are skipped for callers without `reports:financial` — the redacted
     // response never reads them, so paying to fetch them is pure waste at scale.
     // For non-financial callers we still need the SALES COUNT (for totals.sales), so
     // we run a cheap `count` instead of the full findMany.
    const salesWhere = {
      salonId: salonFilter,
      createdAt: { gte: startDate, lte: endDate },
      invoice: { isNot: null },
    };
    const [
      salesData,
      appointmentsData,
      clientsData,
      saleItemsData,
      expensesData,
      redactedSalesCount,
      adjustments,
    ] = await Promise.all([
      // Sales in date range — full rows only when financial.
      canViewFinancial
        ? prisma.sale.findMany({
            where: salesWhere,
            select: {
              createdAt: true,
              finalAmount: true,
            },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([] as { createdAt: Date; finalAmount: Prisma.Decimal }[]),

      // Appointments in date range
      prisma.appointment.findMany({
        where: {
          salonId: salonFilter,
          startTime: { gte: startDate, lte: endDate },
        },
        select: { status: true, startTime: true },
      }),

      // Clients created in date range
      prisma.client.findMany({
        where: {
          salonId: salonFilter,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

      // Sale items — fully skipped when not financial (only feeds money breakdowns).
      canViewFinancial
        ? prisma.saleItem.findMany({
            where: {
              salonId: salonFilter,
              sale: {
                createdAt: { gte: startDate, lte: endDate },
                invoice: { isNot: null },
              },
            },
            include: {
              service: { select: { id: true, name: true } },
              product: { select: { id: true, name: true } },
              staff: { select: { id: true, firstName: true, lastName: true } },
              sale: { select: { createdAt: true, clientId: true, client: { select: { firstName: true, lastName: true } } } },
            },
          })
        : Promise.resolve([] as Prisma.SaleItemGetPayload<{
            include: {
              service: { select: { id: true; name: true } };
              product: { select: { id: true; name: true } };
              staff: { select: { id: true; firstName: true; lastName: true } };
              sale: { select: { createdAt: true; clientId: true; client: { select: { firstName: true; lastName: true } } } };
            };
          }>[]),

      // Expenses — fully skipped when not financial (only feeds money breakdowns).
      canViewFinancial
        ? prisma.expense.findMany({
            where: {
              salonId: salonFilter,
              date: { gte: startDate, lte: endDate },
            },
            select: {
              amount: true,
              date: true,
              category: { select: { name: true, color: true } },
            },
          })
        : Promise.resolve([] as { amount: Prisma.Decimal; date: Date; category: { name: string; color: string } }[]),

      // Cheap fallback: count of sales for redacted callers (so totals.sales is correct
      // even though we didn't fetch full sale rows).
      canViewFinancial
        ? Promise.resolve(0)
        : prisma.sale.count({ where: salesWhere }),

      // Refunds and cancellations made in the range (money only): they come off revenue, and a
      // restock off cost, on the day they happen — see lib/utils/revenue-adjustments.ts.
      canViewFinancial
        ? loadRevenueAdjustments(salonIds, { gte: startDate, lte: endDate })
        : Promise.resolve([] as ReportAdjustment[]),
    ]);

    // Revenue by day: sales made that day, less that day's refunds and cancellations.
    const revenueByDayMap = new Map<string, { revenue: number; salesCount: number }>();
    const addRevenue = (at: Date, amount: number, sales: number): void => {
      const dateKey = formatInTz(at, "yyyy-MM-dd", tz);
      const existing = revenueByDayMap.get(dateKey) || { revenue: 0, salesCount: 0 };
      existing.revenue += amount;
      existing.salesCount += sales;
      revenueByDayMap.set(dateKey, existing);
    };
    salesData.forEach((sale) => addRevenue(sale.createdAt, Number(sale.finalAmount), 1));
    adjustments.forEach((a) => addRevenue(a.at, revenueChange(a), 0));

    // Cost by day (from sale items with costAtSale, bucketed by sale.createdAt to match revenue), less
    // the cost of products that came back into stock that day.
    const costByDayMap = new Map<string, number>();
    const addCost = (at: Date, amount: number): void => {
      const dateKey = formatInTz(at, "yyyy-MM-dd", tz);
      costByDayMap.set(dateKey, (costByDayMap.get(dateKey) || 0) + amount);
    };
    saleItemsData.forEach((item) => {
      if (item.costAtSale != null) addCost(item.sale.createdAt, Number(item.costAtSale) * item.quantity);
    });
    adjustments.forEach((a) => {
      const cost = costChange(a);
      if (cost !== 0) addCost(a.at, cost);
    });

    // Expenses by day (use stored calendar date — @db.Date is midnight UTC)
    const expensesByDayMap = new Map<string, number>();
    expensesData.forEach((expense) => {
      const dateKey = expense.date.toISOString().slice(0, 10);
      expensesByDayMap.set(dateKey, (expensesByDayMap.get(dateKey) || 0) + Number(expense.amount));
    });

    // Merge revenue, expenses, and cost by day (include all dates from all maps)
    const allDates = new Set([...revenueByDayMap.keys(), ...expensesByDayMap.keys(), ...costByDayMap.keys()]);
    const revenueByDay = Array.from(allDates)
      .map((date) => {
        const revenue = revenueByDayMap.get(date)?.revenue || 0;
        return {
          date,
          revenue,
          salesCount: revenueByDayMap.get(date)?.salesCount || 0,
          expenses: expensesByDayMap.get(date) || 0,
          ...(canViewProfit && {
            cost: costByDayMap.get(date) || 0,
            profit: revenue - (costByDayMap.get(date) || 0),
          }),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Money breakdowns by item, staff member and client: one line per item sold, plus a negative line
    // per item on each refund or cancellation in the range (see lib/utils/report-breakdowns.ts).
    const lines: ReportLine[] = [
      ...saleItemsData.map((item) =>
        reportLine(
          item,
          {
            key: item.sale?.clientId ?? "unknown",
            name: item.sale?.client ? `${item.sale.client.firstName} ${item.sale.client.lastName || ""}`.trim() : "Unknown",
          },
          item.saleId,
          Number(item.price) * item.quantity,
          item.costAtSale != null ? Number(item.costAtSale) * item.quantity : 0
        )
      ),
      ...adjustments.flatMap((a) =>
        itemChanges(a).map((c) =>
          reportLine(c.item, { key: a.bill.clientId, name: a.bill.clientName }, null, c.revenue, c.cost)
        )
      ),
    ];
    const revenueByItem = revenueByItemOf(lines, canViewProfit);
    const revenueByStaff = revenueByStaffOf(lines, canViewProfit);
    const profitByClient: ReportData["profitByClient"] = canViewProfit ? profitByClientOf(lines) : undefined;

    // Appointments by status
    const statusCountMap = new Map<string, number>();
    appointmentsData.forEach((apt) => {
      statusCountMap.set(apt.status, (statusCountMap.get(apt.status) || 0) + 1);
    });

    const appointmentsByStatus = Array.from(statusCountMap.entries())
      .map(([status, count]) => ({ status, count }));

    // Client growth (cumulative)
    const clientGrowthMap = new Map<string, number>();
    clientsData.forEach((client) => {
      const dateKey = formatInTz(client.createdAt, "yyyy-MM-dd", tz);
      clientGrowthMap.set(dateKey, (clientGrowthMap.get(dateKey) || 0) + 1);
    });

    // Get total clients before start date
    const clientsBeforeStart = await prisma.client.count({
      where: { salonId: salonFilter, createdAt: { lt: startDate } },
    });

    let runningTotal = clientsBeforeStart;
    const clientGrowth = Array.from(clientGrowthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, newClients]) => {
        runningTotal += newClients;
        return { date, newClients, totalClients: runningTotal };
      });

    // Peak hours
    const hourCountMap = new Map<number, number>();
    appointmentsData.forEach((apt) => {
      const hour = toSalonTz(apt.startTime, tz).getHours();
      hourCountMap.set(hour, (hourCountMap.get(hour) || 0) + 1);
    });

    const peakHours = Array.from(hourCountMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    // Expenses by category
    const expCatMap = new Map<string, { color: string; amount: number }>();
    expensesData.forEach((expense) => {
      const catName = expense.category.name;
      const existing = expCatMap.get(catName);
      if (existing) {
        existing.amount += Number(expense.amount);
      } else {
        expCatMap.set(catName, {
          color: expense.category.color || "#6B7280",
          amount: Number(expense.amount),
        });
      }
    });

    const expensesByCategory = Array.from(expCatMap.entries())
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.amount - a.amount);

    const totalExpenses = expensesData.reduce((sum, e) => sum + Number(e.amount), 0);

    // Totals
    const totalRevenue =
      salesData.reduce((sum, s) => sum + Number(s.finalAmount), 0) + sumOf(adjustments, revenueChange);
    const totals: ReportData["totals"] = {
      revenue: totalRevenue,
      // Financial users: salesData is the full sale rows so length is accurate.
      // Redacted users: salesData was skipped; use the cheap count we ran instead.
      sales: canViewFinancial ? salesData.length : redactedSalesCount,
      appointments: appointmentsData.length,
      newClients: clientsData.length,
      expenses: totalExpenses,
    };

    let hasMissingCosts: boolean | undefined;

    if (canViewProfit) {
      const totalCost = saleItemsData.reduce((sum, item) => {
        if (item.costAtSale == null) return sum;
        return sum + Number(item.costAtSale) * item.quantity;
      }, 0) + sumOf(adjustments, costChange); // less products that came back into stock
      const grossProfit = totalRevenue - totalCost;
      totals.cost = totalCost;
      totals.grossProfit = grossProfit;
      totals.profitMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0;
      totals.netProfit = grossProfit - totalExpenses;

      hasMissingCosts = saleItemsData.some((item) => item.costAtSale == null);
    }

    // Redact monetary fields for users without `reports:financial`. Money-bearing fields
    // are OMITTED (undefined), not zeroed — zeroing would lie to the UI ("$0 revenue" is
    // a lie; "no access to revenue" is the truth). Non-financial operational sections
    // (appointments-by-status, client growth, peak hours, counts) still ship so the page
    // isn't empty for view-only roles.
    const capabilities: string[] = [];
    if (canViewProfit) capabilities.push("profit:view");
    if (canViewFinancial) capabilities.push("reports:financial");

    const redactedTotals: ReportData["totals"] = canViewFinancial
      ? totals
      : {
          sales: totals.sales,
          appointments: totals.appointments,
          newClients: totals.newClients,
        };

    const data: ReportData = {
      ...(canViewFinancial && { revenueByDay, revenueByItem, revenueByStaff }),
      ...(canViewFinancial && profitByClient && { profitByClient }),
      appointmentsByStatus,
      clientGrowth,
      peakHours,
      ...(canViewFinancial && { expensesByCategory }),
      totals: redactedTotals,
      ...(canViewFinancial && canViewProfit && { hasMissingCosts }),
      capabilities,
      currencyCode,
    };

    await cacheSet(cacheKey, data, 600); // 10 min TTL

    return { success: true, data };
  } catch (error) {
    console.error("Error fetching report data:", error);
    return { success: false, error: "Failed to fetch report data" };
  }
}
