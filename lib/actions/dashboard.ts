"use server";

import { prisma } from "@/lib/prisma";
import { primaryStaff } from "@/lib/utils/appointment";
import { checkAuthBasic } from "@/lib/auth-helpers";
import { hasPermission } from "@/lib/permissions";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { AppointmentStatus } from "@prisma/client";
import { getSettings } from "./settings";
import {
  getNow,
  getTodayRange,
  getWeekRange,
  getMonthRange,
  formatInTz,
} from "@/lib/utils/timezone";
import { ActionResult } from "@/lib/types";
import { cacheGet, cacheSet } from "@/lib/redis";
import { getOrganizationSalonIds, getOrgRootSalonId } from "./branch";
import { getDisabledModulesForSalon } from "./modules";
import { loadRevenueAdjustments, type ReportAdjustment } from "@/lib/report-adjustments";
import { costChange, itemChanges, revenueChange, sumOf } from "@/lib/utils/revenue-adjustments";

// The reports action lives in ./report-data; its data shape is re-exported (as a type only, which
// the "use server" build erases) so the report components keep importing it from here.
export type { ReportData } from "./report-data";

// Dashboard stats
export interface DashboardStats {
  todaysAppointments?: {
    total: number;
    completed: number;
    remaining: number;
    cancelled: number;
  };
  todaysRevenue?: {
    amount: number;
    salesCount: number;
    comparison: number; // percentage change from yesterday
    collected: number; // cash actually received today (by paidAt, incl. deposits)
    depositsHeld: number; // outstanding prepayments not yet applied (a liability)
  };
  clients?: {
    total: number;
    newThisWeek: number;
    newThisMonth: number;
  };
  topServices?: {
    name: string;
    count: number;
    revenue: number;
  }[];
  recentSales?: {
    id: string;
    clientName: string;
    amount: number;
    createdAt: Date;
    invoiceNumber: string | null;
  }[];
  upcomingAppointments?: {
    id: string;
    clientName: string;
    serviceName: string;
    staffName: string;
    startTime: Date;
    status: AppointmentStatus;
  }[];
  staffPerformance?: {
    staffId: string;
    staffName: string;
    appointmentsCount: number;
    revenue: number;
  }[];
  todaysExpenses?: {
    amount: number;
    count: number;
  };
  monthlyPayroll?: {
    totalNetPay: number;
    paidCount: number;
    pendingCount: number;
  };
  todaysProfit?: {
    revenue: number;
    cost: number;
    grossProfit: number;
    margin: number; // percentage
  };
  currencyCode: string;
  permissions?: {
    canViewAppointments: boolean;
    canViewSales: boolean;
    canViewClients: boolean;
    canViewStaff: boolean;
    canViewExpenses: boolean;
    canViewPayroll: boolean;
    canViewProfit: boolean;
  };
}

export async function getDashboardStats(params?: {
  branchFilter?: "current" | "all";
}): Promise<ActionResult<DashboardStats>> {
  const authResult = await checkAuthBasic();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const branchFilter = params?.branchFilter || "current";
    const [rawApt, rawSal, rawCli, rawStf, rawExp, rawPay, rawPft, canViewAllBranches] = await Promise.all([
      hasPermission(authResult.roleId, "appointments:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "sales:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "clients:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "staff:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "expenses:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "payroll:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "profit:view", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
      hasPermission(authResult.roleId, "data:all-branches", authResult.isSuperAdmin, authResult.salonId, authResult.userId),
    ]);

    // Respect per-salon module toggles: a disabled module's widgets are hidden
    // (and its data isn't computed). Effective super admin ("Enter salon") bypasses.
    const disabledModules = authResult.isSuperAdmin
      ? new Set<string>()
      : new Set(await getDisabledModulesForSalon(authResult.salonId));
    const canViewAppointments = rawApt && !disabledModules.has("appointments");
    const canViewSales = rawSal && !disabledModules.has("sales");
    const canViewClients = rawCli && !disabledModules.has("clients");
    const canViewStaff = rawStf && !disabledModules.has("staff");
    const canViewExpenses = rawExp && !disabledModules.has("expenses");
    const canViewPayroll = rawPay && !disabledModules.has("payroll");
    // Profit analytics belongs to the Reports module.
    const canViewProfit = rawPft && !disabledModules.has("reports");

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

    // Check cache — use org root ID for org-wide queries so invalidation works correctly
    let cacheKey: string;
    if (branchFilter === "all" && canViewAllBranches) {
      const orgRootId = await getOrgRootSalonId(authResult.salonId);
      cacheKey = `org:${orgRootId}:dashboard:stats:${tz}:${currencyCode}:apt=${canViewAppointments}:sal=${canViewSales}:cli=${canViewClients}:stf=${canViewStaff}:exp=${canViewExpenses}:pay=${canViewPayroll}:pft=${canViewProfit}`;
    } else {
      cacheKey = `salon:${authResult.salonId}:dashboard:stats:${tz}:${currencyCode}:apt=${canViewAppointments}:sal=${canViewSales}:cli=${canViewClients}:stf=${canViewStaff}:exp=${canViewExpenses}:pay=${canViewPayroll}:pft=${canViewProfit}`;
    }
    const cached = await cacheGet<DashboardStats>(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    const { start: todayStart, end: todayEnd } = getTodayRange(tz);
    const { start: weekStart } = getWeekRange(tz);
    const { start: monthStart } = getMonthRange(tz);

    // Date-only boundary for expense queries (@db.Date stored as midnight UTC)
    const expTodayDate = new Date(formatInTz(new Date(), "yyyy-MM-dd", tz) + "T00:00:00Z");

    // Yesterday's range for comparison (timezone-aware to handle DST transitions)
    const yesterdayInTz = subDays(getNow(tz), 1);
    const yesterdayStart = new Date(startOfDay(yesterdayInTz).toISOString());
    const yesterdayEnd = new Date(endOfDay(yesterdayInTz).toISOString());

    // Fetch all stats in parallel
    const [
      todaysAppointmentsData,
      todaysSales,
      yesterdaysSales,
      totalClients,
      newClientsThisWeek,
      newClientsThisMonth,
      topServicesData,
      recentSalesData,
      upcomingAppointmentsData,
      staffPerformanceData,
      todaysExpensesData,
      monthlyPayrollData,
      todaysSaleItemsData,
      todaysCollectedData,
      depositsHeldData,
      adjustments,
    ] = await Promise.all([
      // Today's appointments (only if permitted)
      canViewAppointments
        ? prisma.appointment.groupBy({
            by: ["status"],
            where: {
              salonId: salonFilter,
              startTime: { gte: todayStart, lt: todayEnd },
            },
            _count: { id: true },
          })
        : Promise.resolve([]),

      // Today's sales (needed for revenue and profit)
      (canViewSales || canViewProfit)
        ? prisma.sale.findMany({
            where: {
              salonId: salonFilter,
              createdAt: { gte: todayStart, lt: todayEnd },
              invoice: { isNot: null },
            },
            select: { finalAmount: true },
          })
        : Promise.resolve([]),

      // Yesterday's sales for comparison (only if permitted)
      canViewSales
        ? prisma.sale.findMany({
            where: {
              salonId: salonFilter,
              createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
              invoice: { isNot: null },
            },
            select: { finalAmount: true },
          })
        : Promise.resolve([]),

      // Total active clients (only if permitted)
      canViewClients
        ? prisma.client.count({ where: { salonId: salonFilter, isActive: true } })
        : Promise.resolve(0),

      // New clients this week (only if permitted)
      canViewClients
        ? prisma.client.count({
            where: {
              salonId: salonFilter,
              createdAt: { gte: weekStart },
              isActive: true,
            },
          })
        : Promise.resolve(0),

      // New clients this month (only if permitted)
      canViewClients
        ? prisma.client.count({
            where: {
              salonId: salonFilter,
              createdAt: { gte: monthStart },
              isActive: true,
            },
          })
        : Promise.resolve(0),

      // Top services this month (only if sales permitted)
      canViewSales
        ? prisma.saleItem.groupBy({
            by: ["serviceId"],
            where: {
              salonId: salonFilter,
              createdAt: { gte: monthStart },
              serviceId: { not: null },
            },
            _count: { id: true },
            _sum: { price: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
          })
        : Promise.resolve([]),

      // Recent sales (only if permitted)
      canViewSales
        ? prisma.sale.findMany({
            where: { salonId: salonFilter, invoice: { isNot: null } },
            include: {
              client: { select: { firstName: true, lastName: true } },
              invoice: { select: { invoiceNumber: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
        : Promise.resolve([]),

      // Upcoming appointments (only if permitted)
      canViewAppointments
        ? prisma.appointment.findMany({
            where: {
              salonId: salonFilter,
              startTime: { gte: new Date() },
              status: { in: ["SCHEDULED", "CONFIRMED"] },
            },
            include: {
              client: { select: { firstName: true, lastName: true } },
              services: {
                orderBy: { order: "asc" },
                select: {
                  service: { select: { name: true } },
                  staff: { select: { firstName: true, lastName: true } },
                },
              },
            },
            orderBy: { startTime: "asc" },
            take: 5,
          })
        : Promise.resolve([]),

      // Staff performance this month (only if permitted)
      canViewStaff
        ? prisma.saleItem.groupBy({
            by: ["staffId"],
            where: {
              salonId: salonFilter,
              createdAt: { gte: monthStart },
              staffId: { not: null },
            },
            _count: { id: true },
            _sum: { price: true },
          })
        : Promise.resolve([]),

      // Today's expenses (only if user has permission)
      canViewExpenses
        ? prisma.expense.findMany({
            where: {
              salonId: salonFilter,
              date: { equals: expTodayDate },
            },
            select: { amount: true },
          })
        : Promise.resolve([]),

      // Monthly payroll data (only if user has permission)
      canViewPayroll
        ? prisma.payrollEntry.groupBy({
            by: ["status"],
            where: {
              payrollRun: {
                salonId: salonFilter,
                periodStart: { gte: monthStart },
                status: { in: ["PAID", "FINALIZED"] },
              },
            },
            _sum: { netPay: true },
            _count: { id: true },
          })
        : Promise.resolve([]),

      // Today's sale item costs (for profit tracking, only if owner)
      canViewProfit
        ? prisma.saleItem.findMany({
            where: {
              salonId: salonFilter,
              sale: {
                createdAt: { gte: todayStart, lt: todayEnd },
                invoice: { isNot: null },
              },
            },
            select: { quantity: true, costAtSale: true },
          })
        : Promise.resolve([]),

      // Cash collected today (by paidAt, includes deposits taken today) — for the
      // Revenue-vs-Collected reconciliation. Scoped via invoice or appointment salon.
      canViewSales
        ? prisma.payment.aggregate({
            where: {
              paidAt: { gte: todayStart, lt: todayEnd },
              OR: [
                { invoice: { salonId: salonFilter } },
                { appointment: { salonId: salonFilter } },
              ],
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),

      // Deposits held = outstanding prepayments not yet applied to an invoice (a liability).
      // Summed in the database so this doesn't grow with payment history.
      canViewSales
        ? prisma.payment.aggregate({
            where: {
              invoiceId: null,
              appointmentId: { not: null },
              appointment: { salonId: salonFilter },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),

      // Refunds and cancellations since the earlier of this month and yesterday: they come off
      // revenue on the day they happen (see lib/utils/revenue-adjustments.ts).
      (canViewSales || canViewProfit || canViewStaff)
        ? loadRevenueAdjustments(salonIds, {
            gte: monthStart < yesterdayStart ? monthStart : yesterdayStart,
            lt: todayEnd,
          })
        : Promise.resolve([] as ReportAdjustment[]),
    ]);
    const adjustedBetween = (start: Date, end: Date): ReportAdjustment[] =>
      adjustments.filter((a) => a.at >= start && a.at < end);
    const todaysAdjustments = adjustedBetween(todayStart, todayEnd);
    // Per service and per staff member, what this month's refunds and cancellations took off.
    const monthItemChanges = adjustedBetween(monthStart, todayEnd).flatMap(itemChanges);
    // Per unit, like the figures it is taken from (those sum each item's price, not price × quantity).
    const monthChangeBy = (key: "serviceId" | "staffId", id: string | null): number =>
      monthItemChanges.filter((c) => c.item[key] === id).reduce((sum, c) => sum + c.revenue / c.item.quantity, 0);

    // Process appointments data
    const appointmentsByStatus = todaysAppointmentsData.reduce(
      (acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    const totalAppointments = Object.values(appointmentsByStatus).reduce((a, b) => a + b, 0);
    const completedAppointments = appointmentsByStatus["COMPLETED"] || 0;
    const cancelledAppointments = (appointmentsByStatus["CANCELLED"] || 0) + (appointmentsByStatus["NO_SHOW"] || 0);
    const remainingAppointments = totalAppointments - completedAppointments - cancelledAppointments;

    // Process revenue data
    // Sales made that day, less that day's refunds and cancellations.
    const todaysRevenue =
      todaysSales.reduce((sum, s) => sum + Number(s.finalAmount), 0) + sumOf(todaysAdjustments, revenueChange);
    const yesterdaysRevenue =
      yesterdaysSales.reduce((sum, s) => sum + Number(s.finalAmount), 0) +
      sumOf(adjustedBetween(yesterdayStart, yesterdayEnd), revenueChange);
    const revenueComparison = yesterdaysRevenue > 0
      ? ((todaysRevenue - yesterdaysRevenue) / yesterdaysRevenue) * 100
      : todaysRevenue > 0 ? 100 : 0;
    const todaysCollected = Number(todaysCollectedData._sum.amount ?? 0);
    const depositsHeld = Number(depositsHeldData._sum.amount ?? 0);

    // Get service names for top services
    const serviceIds = topServicesData.map((s) => s.serviceId).filter((id): id is string => id !== null);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true },
    });
    const serviceMap = new Map(services.map((s) => [s.id, s.name]));

    const topServices = topServicesData.map((item) => ({
      name: (item.serviceId && serviceMap.get(item.serviceId)) || "Unknown",
      count: item._count.id,
      revenue: (Number(item._sum.price) || 0) + monthChangeBy("serviceId", item.serviceId),
    }));

    // Process recent sales
    const recentSales = recentSalesData.map((sale) => ({
      id: sale.id,
      clientName: `${sale.client.firstName} ${sale.client.lastName || ""}`.trim(),
      amount: Number(sale.finalAmount),
      createdAt: sale.createdAt,
      invoiceNumber: sale.invoice?.invoiceNumber || null,
    }));

    // Process upcoming appointments
    const upcomingAppointments = upcomingAppointmentsData.map((apt) => ({
      id: apt.id,
      clientName: `${apt.client.firstName} ${apt.client.lastName || ""}`.trim(),
      serviceName:
        (apt.services[0]?.service.name ?? "") +
        (apt.services.length > 1 ? ` +${apt.services.length - 1}` : ""),
      staffName: `${primaryStaff(apt.services).firstName} ${primaryStaff(apt.services).lastName}`,
      startTime: apt.startTime,
      status: apt.status,
    }));

    // Get staff names for performance
    const staffIds = staffPerformanceData.map((s) => s.staffId).filter((id): id is string => id !== null);
    const staffMembers = await prisma.user.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const staffMap = new Map(staffMembers.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));

    const staffPerformance = staffPerformanceData
      .map((item) => ({
        staffId: item.staffId ?? "",
        staffName: (item.staffId && staffMap.get(item.staffId)) || "Unknown",
        appointmentsCount: item._count.id,
        revenue: (Number(item._sum.price) || 0) + monthChangeBy("staffId", item.staffId),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const data: DashboardStats = {
      ...(canViewAppointments && {
        todaysAppointments: {
          total: totalAppointments,
          completed: completedAppointments,
          remaining: remainingAppointments,
          cancelled: cancelledAppointments,
        },
      }),
      ...(canViewSales && {
        todaysRevenue: {
          amount: todaysRevenue,
          salesCount: todaysSales.length,
          comparison: Math.round(revenueComparison * 10) / 10,
          collected: todaysCollected,
          depositsHeld,
        },
      }),
      ...(canViewClients && {
        clients: {
          total: totalClients,
          newThisWeek: newClientsThisWeek,
          newThisMonth: newClientsThisMonth,
        },
      }),
      ...(canViewSales && { topServices }),
      ...(canViewSales && { recentSales }),
      ...(canViewAppointments && { upcomingAppointments }),
      ...(canViewStaff && { staffPerformance }),
      ...(canViewExpenses && {
        todaysExpenses: {
          amount: todaysExpensesData.reduce((sum, e) => sum + Number(e.amount), 0),
          count: todaysExpensesData.length,
        },
      }),
      ...(canViewPayroll && monthlyPayrollData.length > 0 && {
        monthlyPayroll: ((): NonNullable<DashboardStats["monthlyPayroll"]> => {
          type PayrollGroup = { status: string; _sum: { netPay: unknown }; _count: { id: number } };
          const groups = monthlyPayrollData as PayrollGroup[];
          return {
            totalNetPay: groups.reduce((sum, g) => sum + Number(g._sum.netPay || 0), 0),
            paidCount: groups
              .filter((g) => g.status === "PAID")
              .reduce((sum, g) => sum + g._count.id, 0),
            pendingCount: groups
              .filter((g) => g.status === "PENDING")
              .reduce((sum, g) => sum + g._count.id, 0),
          };
        })(),
      }),
      ...(canViewProfit && {
        todaysProfit: ((): NonNullable<DashboardStats["todaysProfit"]> => {
          type SaleItemCost = { quantity: number; costAtSale: unknown };
          const items = todaysSaleItemsData as SaleItemCost[];
          const revenue = todaysRevenue;
          // Less the cost of products that came back into stock today (a full refund or a cancel).
          const totalCost = items.reduce((sum, item) => {
            if (item.costAtSale == null) return sum;
            return sum + Number(item.costAtSale) * item.quantity;
          }, 0) + sumOf(todaysAdjustments, costChange);
          const grossProfit = revenue - totalCost;
          const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
          return { revenue, cost: totalCost, grossProfit, margin };
        })(),
      }),
      currencyCode,
      permissions: {
        canViewAppointments,
        canViewSales,
        canViewClients,
        canViewStaff,
        canViewExpenses,
        canViewPayroll,
        canViewProfit,
      },
    };

    await cacheSet(cacheKey, data, 300); // 5 min TTL

    return { success: true, data };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return { success: false, error: "Failed to fetch dashboard statistics" };
  }
}

