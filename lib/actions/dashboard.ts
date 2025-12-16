"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { Role, AppointmentStatus } from "@prisma/client";
import { getSettings } from "./settings";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function checkAuth(): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { userId: session.user.id, role: session.user.role as Role };
}

// Get today's date range
function getTodayRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { start: today, end: tomorrow };
}

// Get this week's date range
function getWeekRange() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return { start: startOfWeek, end: endOfWeek };
}

// Get this month's date range
function getMonthRange() {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: startOfMonth, end: endOfMonth };
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
  currencySymbol: string;
}

export async function getDashboardStats(): Promise<ActionResult<DashboardStats>> {
  const authResult = await checkAuth();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const { start: todayStart, end: todayEnd } = getTodayRange();
    const { start: weekStart } = getWeekRange();
    const { start: monthStart } = getMonthRange();

    // Yesterday's range for comparison
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);

    // Get settings for currency
    const settingsResult = await getSettings();
    const currencySymbol = settingsResult.success ? settingsResult.data.currencySymbol : "$";

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
    ] = await Promise.all([
      // Today's appointments
      prisma.appointment.groupBy({
        by: ["status"],
        where: {
          startTime: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),

      // Today's sales (completed)
      prisma.sale.findMany({
        where: {
          createdAt: { gte: todayStart, lt: todayEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),

      // Yesterday's sales for comparison
      prisma.sale.findMany({
        where: {
          createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          invoice: { isNot: null },
        },
        select: { finalAmount: true },
      }),

      // Total active clients
      prisma.client.count({ where: { isActive: true } }),

      // New clients this week
      prisma.client.count({
        where: {
          createdAt: { gte: weekStart },
          isActive: true,
        },
      }),

      // New clients this month
      prisma.client.count({
        where: {
          createdAt: { gte: monthStart },
          isActive: true,
        },
      }),

      // Top services this month
      prisma.saleItem.groupBy({
        by: ["serviceId"],
        where: {
          createdAt: { gte: monthStart },
        },
        _count: { id: true },
        _sum: { price: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),

      // Recent sales
      prisma.sale.findMany({
        where: { invoice: { isNot: null } },
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

      // Staff performance this month
      prisma.saleItem.groupBy({
        by: ["staffId"],
        where: {
          createdAt: { gte: monthStart },
        },
        _count: { id: true },
        _sum: { price: true },
      }),
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
    const serviceIds = topServicesData.map((s) => s.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true },
    });
    const serviceMap = new Map(services.map((s) => [s.id, s.name]));

    const topServices = topServicesData.map((item) => ({
      name: serviceMap.get(item.serviceId) || "Unknown",
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
    const staffIds = staffPerformanceData.map((s) => s.staffId);
    const staffMembers = await prisma.user.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const staffMap = new Map(staffMembers.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));

    const staffPerformance = staffPerformanceData
      .map((item) => ({
        staffId: item.staffId,
        staffName: staffMap.get(item.staffId) || "Unknown",
        appointmentsCount: item._count.id,
        revenue: Number(item._sum.price) || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      success: true,
      data: {
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
        currencySymbol,
      },
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return { success: false, error: "Failed to fetch dashboard statistics" };
  }
}

// Reports data
export interface ReportData {
  revenueByDay: { date: string; revenue: number; salesCount: number }[];
  revenueByService: { service: string; revenue: number; percentage: number }[];
  revenueByStaff: { staff: string; revenue: number; appointments: number }[];
  appointmentsByStatus: { status: string; count: number }[];
  clientGrowth: { date: string; newClients: number; totalClients: number }[];
  peakHours: { hour: number; count: number }[];
  totals: {
    revenue: number;
    sales: number;
    appointments: number;
    newClients: number;
  };
  currencySymbol: string;
}

export async function getReportData(params: {
  startDate: Date;
  endDate: Date;
}): Promise<ActionResult<ReportData>> {
  const authResult = await checkAuth();
  if (!authResult) {
    return { success: false, error: "Unauthorized" };
  }

  if (!hasPermission(authResult.role, "reports:view")) {
    return { success: false, error: "You don't have permission to view reports" };
  }

  const { startDate, endDate } = params;

  try {
    // Get settings for currency
    const settingsResult = await getSettings();
    const currencySymbol = settingsResult.success ? settingsResult.data.currencySymbol : "$";

    // Fetch all report data in parallel
    const [
      salesData,
      appointmentsData,
      clientsData,
      saleItemsData,
    ] = await Promise.all([
      // Sales in date range
      prisma.sale.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          invoice: { isNot: null },
        },
        include: {
          items: {
            include: {
              service: { select: { name: true } },
              staff: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),

      // Appointments in date range
      prisma.appointment.findMany({
        where: {
          startTime: { gte: startDate, lte: endDate },
        },
        select: { status: true, startTime: true },
      }),

      // Clients created in date range
      prisma.client.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

      // Sale items for service breakdown
      prisma.saleItem.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        include: {
          service: { select: { name: true } },
          staff: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    // Revenue by day
    const revenueByDayMap = new Map<string, { revenue: number; salesCount: number }>();
    salesData.forEach((sale) => {
      const dateKey = sale.createdAt.toISOString().split("T")[0];
      const existing = revenueByDayMap.get(dateKey) || { revenue: 0, salesCount: 0 };
      existing.revenue += Number(sale.finalAmount);
      existing.salesCount += 1;
      revenueByDayMap.set(dateKey, existing);
    });

    const revenueByDay = Array.from(revenueByDayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Revenue by service
    const serviceRevenueMap = new Map<string, number>();
    let totalServiceRevenue = 0;
    saleItemsData.forEach((item) => {
      const serviceName = item.service.name;
      const amount = Number(item.price) * item.quantity;
      serviceRevenueMap.set(serviceName, (serviceRevenueMap.get(serviceName) || 0) + amount);
      totalServiceRevenue += amount;
    });

    const revenueByService = Array.from(serviceRevenueMap.entries())
      .map(([service, revenue]) => ({
        service,
        revenue,
        percentage: totalServiceRevenue > 0 ? Math.round((revenue / totalServiceRevenue) * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Revenue by staff
    const staffRevenueMap = new Map<string, { revenue: number; appointments: number }>();
    saleItemsData.forEach((item) => {
      const staffName = `${item.staff.firstName} ${item.staff.lastName}`;
      const amount = Number(item.price) * item.quantity;
      const existing = staffRevenueMap.get(staffName) || { revenue: 0, appointments: 0 };
      existing.revenue += amount;
      existing.appointments += 1;
      staffRevenueMap.set(staffName, existing);
    });

    const revenueByStaff = Array.from(staffRevenueMap.entries())
      .map(([staff, data]) => ({ staff, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

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
      const dateKey = client.createdAt.toISOString().split("T")[0];
      clientGrowthMap.set(dateKey, (clientGrowthMap.get(dateKey) || 0) + 1);
    });

    // Get total clients before start date
    const clientsBeforeStart = await prisma.client.count({
      where: { createdAt: { lt: startDate } },
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
      const hour = new Date(apt.startTime).getHours();
      hourCountMap.set(hour, (hourCountMap.get(hour) || 0) + 1);
    });

    const peakHours = Array.from(hourCountMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    // Totals
    const totals = {
      revenue: salesData.reduce((sum, s) => sum + Number(s.finalAmount), 0),
      sales: salesData.length,
      appointments: appointmentsData.length,
      newClients: clientsData.length,
    };

    return {
      success: true,
      data: {
        revenueByDay,
        revenueByService,
        revenueByStaff,
        appointmentsByStatus,
        clientGrowth,
        peakHours,
        totals,
        currencySymbol,
      },
    };
  } catch (error) {
    console.error("Error fetching report data:", error);
    return { success: false, error: "Failed to fetch report data" };
  }
}
