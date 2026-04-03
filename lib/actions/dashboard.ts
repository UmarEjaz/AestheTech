"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { Role, AppointmentStatus } from "@prisma/client";
import { getSettings } from "./settings";
import {
  getNow,
  getTodayRange,
  getWeekRange,
  getMonthRange,
  toSalonTz,
  formatInTz,
} from "@/lib/utils/timezone";
import { ActionResult } from "@/lib/types";
import { cacheGet, cacheSet } from "@/lib/redis";
import { getOrganizationSalonIds, getOrgRootSalonId } from "./branch";

async function checkAuth(): Promise<{ userId: string; role: Role; salonId: string; isSuperAdmin: boolean } | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (!session.user.salonRole) return null;
  const salonId = session.user.salonId;
  if (!salonId) return null;
  return { userId: session.user.id, role: session.user.salonRole as Role, salonId, isSuperAdmin: session.user.isSuperAdmin === true };
}

// Dashboard stats
export interface DashboardStats {
  todaysAppointments: {
    total: number;
    completed: number;
    remaining: number;
    cancelled: number;
  };
  todaysRevenue: {
    amount: number;
    salesCount: number;
    comparison: number; // percentage change from yesterday
  };
  clients: {
    total: number;
    newThisWeek: number;
    newThisMonth: number;
  };
  topServices: {
    name: string;
    count: number;
    revenue: number;
  }[];
  recentSales: {
    id: string;
    clientName: string;
    amount: number;
    createdAt: Date;
    invoiceNumber: string | null;
  }[];
  upcomingAppointments: {
    id: string;
    clientName: string;
    serviceName: string;
    staffName: string;
    startTime: Date;
    status: AppointmentStatus;
  }[];
  staffPerformance: {
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
}

export async function getDashboardStats(params?: {
  branchFilter?: "current" | "all";
}): Promise<ActionResult<DashboardStats>> {
  const authResult = await checkAuth();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const branchFilter = params?.branchFilter || "current";
    const canViewExpenses = hasPermission(authResult.role, "expenses:view", authResult.isSuperAdmin);
    const canViewPayroll = hasPermission(authResult.role, "payroll:view", authResult.isSuperAdmin);
    const canViewProfit = hasPermission(authResult.role, "profit:view", authResult.isSuperAdmin);
    const isOwnerOrSuperAdmin = authResult.role === "OWNER" || authResult.isSuperAdmin;

    // Determine which salon IDs to query (only owners can view all branches)
    let salonIds: string[];
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
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
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      const orgRootId = await getOrgRootSalonId(authResult.salonId);
      cacheKey = `org:${orgRootId}:dashboard:stats:${tz}:${currencyCode}:exp=${canViewExpenses}:pay=${canViewPayroll}:pft=${canViewProfit}`;
    } else {
      cacheKey = `salon:${authResult.salonId}:dashboard:stats:${tz}:${currencyCode}:exp=${canViewExpenses}:pay=${canViewPayroll}:pft=${canViewProfit}`;
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
    ] = await Promise.all([
      // Today's appointments
      prisma.appointment.groupBy({
        by: ["status"],
        where: {
          salonId: salonFilter,
          startTime: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),

      // Today's sales (completed)
      prisma.sale.findMany({
        where: {
          salonId: salonFilter,
          createdAt: { gte: todayStart, lt: todayEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),

      // Yesterday's sales for comparison
      prisma.sale.findMany({
        where: {
          salonId: salonFilter,
          createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),

      // Total active clients
      prisma.client.count({ where: { salonId: salonFilter, isActive: true } }),

      // New clients this week
      prisma.client.count({
        where: {
          salonId: salonFilter,
          createdAt: { gte: weekStart },
          isActive: true,
        },
      }),

      // New clients this month
      prisma.client.count({
        where: {
          salonId: salonFilter,
          createdAt: { gte: monthStart },
          isActive: true,
        },
      }),

      // Top services this month (only service-based items)
      prisma.saleItem.groupBy({
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
      }),

      // Recent sales
      prisma.sale.findMany({
        where: { salonId: salonFilter, invoice: { isNot: null } },
        include: {
          client: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),

      // Upcoming appointments (today and tomorrow)
      prisma.appointment.findMany({
        where: {
          salonId: salonFilter,
          startTime: { gte: new Date() },
          status: { in: ["SCHEDULED", "CONFIRMED"] },
        },
        include: {
          client: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
          staff: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startTime: "asc" },
        take: 5,
      }),

      // Staff performance this month (only items with staff)
      prisma.saleItem.groupBy({
        by: ["staffId"],
        where: {
          salonId: salonFilter,
          createdAt: { gte: monthStart },
          staffId: { not: null },
        },
        _count: { id: true },
        _sum: { price: true },
      }),

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
    ]);

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
    const todaysRevenue = todaysSales.reduce((sum, s) => sum + Number(s.finalAmount), 0);
    const yesterdaysRevenue = yesterdaysSales.reduce((sum, s) => sum + Number(s.finalAmount), 0);
    const revenueComparison = yesterdaysRevenue > 0
      ? ((todaysRevenue - yesterdaysRevenue) / yesterdaysRevenue) * 100
      : todaysRevenue > 0 ? 100 : 0;

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
      revenue: Number(item._sum.price) || 0,
    }));

    // Process recent sales
    const recentSales = recentSalesData.map((sale) => ({
      id: sale.id,
      clientName: `${sale.client.firstName} ${sale.client.lastName}`,
      amount: Number(sale.finalAmount),
      createdAt: sale.createdAt,
      invoiceNumber: sale.invoice?.invoiceNumber || null,
    }));

    // Process upcoming appointments
    const upcomingAppointments = upcomingAppointmentsData.map((apt) => ({
      id: apt.id,
      clientName: `${apt.client.firstName} ${apt.client.lastName}`,
      serviceName: apt.service.name,
      staffName: `${apt.staff.firstName} ${apt.staff.lastName}`,
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
        revenue: Number(item._sum.price) || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const data: DashboardStats = {
      todaysAppointments: {
        total: totalAppointments,
        completed: completedAppointments,
        remaining: remainingAppointments,
        cancelled: cancelledAppointments,
      },
      todaysRevenue: {
        amount: todaysRevenue,
        salesCount: todaysSales.length,
        comparison: Math.round(revenueComparison * 10) / 10,
      },
      clients: {
        total: totalClients,
        newThisWeek: newClientsThisWeek,
        newThisMonth: newClientsThisMonth,
      },
      topServices,
      recentSales,
      upcomingAppointments,
      staffPerformance,
      ...(canViewExpenses && {
        todaysExpenses: {
          amount: todaysExpensesData.reduce((sum, e) => sum + Number(e.amount), 0),
          count: todaysExpensesData.length,
        },
      }),
      ...(canViewPayroll && monthlyPayrollData.length > 0 && {
        monthlyPayroll: (() => {
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
        todaysProfit: (() => {
          type SaleItemCost = { quantity: number; costAtSale: unknown };
          const items = todaysSaleItemsData as SaleItemCost[];
          const revenue = todaysRevenue;
          const totalCost = items.reduce((sum, item) => {
            if (item.costAtSale == null) return sum;
            return sum + Number(item.costAtSale) * item.quantity;
          }, 0);
          const grossProfit = revenue - totalCost;
          const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
          return { revenue, cost: totalCost, grossProfit, margin };
        })(),
      }),
      currencyCode,
    };

    await cacheSet(cacheKey, data, 300); // 5 min TTL

    return { success: true, data };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return { success: false, error: "Failed to fetch dashboard statistics" };
  }
}

// Reports data
export interface ReportData {
  revenueByDay: { date: string; revenue: number; salesCount: number; expenses: number; cost?: number; profit?: number }[];
  revenueByItem: { item: string; revenue: number; percentage: number; cost?: number; profit?: number; margin?: number }[];
  revenueByStaff: { staff: string; revenue: number; appointments: number; cost?: number; profit?: number }[];
  profitByClient?: { client: string; revenue: number; cost: number; profit: number; margin: number; salesCount: number }[];
  appointmentsByStatus: { status: string; count: number }[];
  clientGrowth: { date: string; newClients: number; totalClients: number }[];
  peakHours: { hour: number; count: number }[];
  expensesByCategory: { category: string; color: string; amount: number }[];
  totals: {
    revenue: number;
    sales: number;
    appointments: number;
    newClients: number;
    expenses: number;
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
  const authResult = await checkAuth();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  if (!hasPermission(authResult.role, "reports:view")) {
    return { success: false, error: "You don't have permission to view reports" };
  }

  const { startDate, endDate, branchFilter = "current" } = params;
  const isOwnerOrSuperAdmin = authResult.role === "OWNER" || authResult.isSuperAdmin;

  try {
    // Determine which salon IDs to query (only owners can view all branches)
    let salonIds: string[];
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      salonIds = await getOrganizationSalonIds(authResult.salonId);
    } else {
      salonIds = [authResult.salonId];
    }
    const salonFilter = { in: salonIds };

    // Get settings for currency and timezone
    const settingsResult = await getSettings();
    const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";
    const tz = settingsResult.success ? settingsResult.data.timezone : "UTC";
    const canViewProfit = hasPermission(authResult.role, "profit:view", authResult.isSuperAdmin);

    // Check cache — use org root ID for org-wide queries so invalidation works correctly
    let cacheKey: string;
    if (branchFilter === "all" && isOwnerOrSuperAdmin) {
      const orgRootId = await getOrgRootSalonId(authResult.salonId);
      cacheKey = `org:${orgRootId}:reports:${tz}:${currencyCode}:pft=${canViewProfit}:${startDate.toISOString()}:${endDate.toISOString()}`;
    } else {
      cacheKey = `salon:${authResult.salonId}:reports:${tz}:${currencyCode}:pft=${canViewProfit}:${startDate.toISOString()}:${endDate.toISOString()}`;
    }
    const cached = await cacheGet<ReportData>(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    // Fetch all report data in parallel
    const [
      salesData,
      appointmentsData,
      clientsData,
      saleItemsData,
      expensesData,
    ] = await Promise.all([
      // Sales in date range
      prisma.sale.findMany({
        where: {
          salonId: salonFilter,
          createdAt: { gte: startDate, lte: endDate },
          invoice: { isNot: null },
        },
        select: {
          createdAt: true,
          finalAmount: true,
        },
        orderBy: { createdAt: "asc" },
      }),

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

      // Sale items for service/product breakdown (filter by sale.createdAt to match revenue bucketing)
      prisma.saleItem.findMany({
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
      }),

      // Expenses in date range
      prisma.expense.findMany({
        where: {
          salonId: salonFilter,
          date: { gte: startDate, lte: endDate },
        },
        select: {
          amount: true,
          date: true,
          category: { select: { name: true, color: true } },
        },
      }),
    ]);

    // Revenue by day
    const revenueByDayMap = new Map<string, { revenue: number; salesCount: number }>();
    salesData.forEach((sale) => {
      const dateKey = formatInTz(sale.createdAt, "yyyy-MM-dd", tz);
      const existing = revenueByDayMap.get(dateKey) || { revenue: 0, salesCount: 0 };
      existing.revenue += Number(sale.finalAmount);
      existing.salesCount += 1;
      revenueByDayMap.set(dateKey, existing);
    });

    // Cost by day (from sale items with costAtSale, bucketed by sale.createdAt to match revenue)
    const costByDayMap = new Map<string, number>();
    saleItemsData.forEach((item) => {
      if (item.costAtSale == null) return;
      const dateKey = formatInTz(item.sale.createdAt, "yyyy-MM-dd", tz);
      costByDayMap.set(dateKey, (costByDayMap.get(dateKey) || 0) + Number(item.costAtSale) * item.quantity);
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

    // Revenue by item (services + products) with cost tracking (keyed by type:id for stability)
    const itemDataMap = new Map<string, { name: string; revenue: number; cost: number }>();
    let totalItemRevenue = 0;
    saleItemsData.forEach((saleItem) => {
      const itemKey = saleItem.service?.id
        ? `svc:${saleItem.service.id}`
        : saleItem.product?.id
          ? `prod:${saleItem.product.id}`
          : `unknown:${saleItem.id}`;
      const itemName = saleItem.service?.name || saleItem.product?.name || "Unknown";
      const amount = Number(saleItem.price) * saleItem.quantity;
      const itemCost = saleItem.costAtSale != null ? Number(saleItem.costAtSale) * saleItem.quantity : 0;
      const existing = itemDataMap.get(itemKey) || { name: itemName, revenue: 0, cost: 0 };
      existing.revenue += amount;
      existing.cost += itemCost;
      itemDataMap.set(itemKey, existing);
      totalItemRevenue += amount;
    });

    const revenueByItem = Array.from(itemDataMap.values())
      .map((data) => {
        const profit = data.revenue - data.cost;
        const margin = data.revenue > 0 ? Math.round((profit / data.revenue) * 1000) / 10 : 0;
        return {
          item: data.name,
          revenue: data.revenue,
          percentage: totalItemRevenue > 0 ? Math.round((data.revenue / totalItemRevenue) * 100) : 0,
          ...(canViewProfit && { cost: data.cost, profit, margin }),
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Revenue by staff with cost tracking (keyed by staff ID for stability)
    const staffRevenueMap = new Map<string, { name: string; revenue: number; cost: number; appointments: number }>();
    saleItemsData.forEach((item) => {
      if (!item.staff) return; // skip product-only items with no staff
      const staffId = item.staff.id;
      const staffName = `${item.staff.firstName} ${item.staff.lastName}`;
      const amount = Number(item.price) * item.quantity;
      const itemCost = item.costAtSale != null ? Number(item.costAtSale) * item.quantity : 0;
      const existing = staffRevenueMap.get(staffId) || { name: staffName, revenue: 0, cost: 0, appointments: 0 };
      existing.revenue += amount;
      existing.cost += itemCost;
      existing.appointments += 1;
      staffRevenueMap.set(staffId, existing);
    });

    const revenueByStaff = Array.from(staffRevenueMap.values())
      .map((data) => ({
        staff: data.name,
        revenue: data.revenue,
        appointments: data.appointments,
        ...(canViewProfit && { cost: data.cost, profit: data.revenue - data.cost }),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Profit by client (keyed by clientId for stability across name changes/duplicates)
    let profitByClient: ReportData["profitByClient"];
    if (canViewProfit) {
      const clientProfitMap = new Map<string, { name: string; revenue: number; cost: number; saleIds: Set<string> }>();
      saleItemsData.forEach((item) => {
        const clientId = item.sale?.clientId ?? "unknown";
        const clientName = item.sale?.client
          ? `${item.sale.client.firstName} ${item.sale.client.lastName || ""}`.trim()
          : "Unknown";
        const amount = Number(item.price) * item.quantity;
        const itemCost = item.costAtSale != null ? Number(item.costAtSale) * item.quantity : 0;
        const existing = clientProfitMap.get(clientId) || { name: clientName, revenue: 0, cost: 0, saleIds: new Set<string>() };
        existing.revenue += amount;
        existing.cost += itemCost;
        existing.saleIds.add(item.saleId);
        clientProfitMap.set(clientId, existing);
      });

      profitByClient = Array.from(clientProfitMap.values())
        .map((data) => {
          const profit = data.revenue - data.cost;
          const margin = data.revenue > 0 ? Math.round((profit / data.revenue) * 1000) / 10 : 0;
          return {
            client: data.name,
            revenue: data.revenue,
            cost: data.cost,
            profit,
            margin,
            salesCount: data.saleIds.size,
          };
        })
        .sort((a, b) => b.profit - a.profit);
    }

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
    const totalRevenue = salesData.reduce((sum, s) => sum + Number(s.finalAmount), 0);
    const totals: ReportData["totals"] = {
      revenue: totalRevenue,
      sales: salesData.length,
      appointments: appointmentsData.length,
      newClients: clientsData.length,
      expenses: totalExpenses,
    };

    let hasMissingCosts: boolean | undefined;

    if (canViewProfit) {
      const totalCost = saleItemsData.reduce((sum, item) => {
        if (item.costAtSale == null) return sum;
        return sum + Number(item.costAtSale) * item.quantity;
      }, 0);
      const grossProfit = totalRevenue - totalCost;
      totals.cost = totalCost;
      totals.grossProfit = grossProfit;
      totals.profitMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0;
      totals.netProfit = grossProfit - totalExpenses;

      hasMissingCosts = saleItemsData.some((item) => item.costAtSale == null);
    }

    const data: ReportData = {
      revenueByDay,
      revenueByItem,
      revenueByStaff,
      ...(profitByClient && { profitByClient }),
      appointmentsByStatus,
      clientGrowth,
      peakHours,
      expensesByCategory,
      totals,
      ...(canViewProfit && { hasMissingCosts }),
      capabilities: canViewProfit ? ["profit:view"] : [],
      currencyCode,
    };

    await cacheSet(cacheKey, data, 600); // 10 min TTL

    return { success: true, data };
  } catch (error) {
    console.error("Error fetching report data:", error);
    return { success: false, error: "Failed to fetch report data" };
  }
}
