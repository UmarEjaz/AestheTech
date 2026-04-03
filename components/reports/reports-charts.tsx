"use client";

import { useState } from "react";
import { subDays, startOfMonth, endOfMonth } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
import { formatCurrency } from "@/lib/utils/currency";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  DollarSign,
  TrendingUp,
  Wallet,
  PiggyBank,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReportData } from "@/lib/actions/dashboard";
import { ExportButtons } from "./export-buttons";
import Link from "next/link";

interface ReportsChartsProps {
  initialData: ReportData;
  onDateRangeChange: (startDate: Date, endDate: Date) => Promise<ReportData | null>;
  timezone: string;
}

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#10b981",
  CONFIRMED: "#06b6d4",
  SCHEDULED: "#8b5cf6",
  CANCELLED: "#ef4444",
  NO_SHOW: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
};

export function ReportsCharts({ initialData, onDateRangeChange, timezone }: ReportsChartsProps) {
  const [data, setData] = useState<ReportData>(initialData);
  const [dateRange, setDateRange] = useState<"week" | "month" | "custom">("month");
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [isLoading, setIsLoading] = useState(false);

  const canViewProfit = data.capabilities?.includes("profit:view");

  const handleDateRangeChange = async (range: "week" | "month" | "custom") => {
    setDateRange(range);
    let newStartDate: Date;
    let newEndDate: Date = new Date();

    if (range === "week") {
      newStartDate = subDays(new Date(), 7);
    } else if (range === "month") {
      newStartDate = startOfMonth(new Date());
      newEndDate = endOfMonth(new Date());
    } else {
      return; // Custom uses the date picker
    }

    setStartDate(newStartDate);
    setEndDate(newEndDate);

    setIsLoading(true);
    const newData = await onDateRangeChange(newStartDate, newEndDate);
    if (newData) {
      setData(newData);
    }
    setIsLoading(false);
  };

  const handleCustomDateChange = async () => {
    setIsLoading(true);
    const newData = await onDateRangeChange(startDate, endDate);
    if (newData) {
      setData(newData);
    }
    setIsLoading(false);
  };

  const fmtCurrency = (value: number) => formatCurrency(value, data.currencyCode);

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex gap-2">
              <Button
                variant={dateRange === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => handleDateRangeChange("week")}
                disabled={isLoading}
              >
                Last 7 Days
              </Button>
              <Button
                variant={dateRange === "month" ? "default" : "outline"}
                size="sm"
                onClick={() => handleDateRangeChange("month")}
                disabled={isLoading}
              >
                This Month
              </Button>
              <Button
                variant={dateRange === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("custom")}
                disabled={isLoading}
              >
                Custom
              </Button>
            </div>

            {dateRange === "custom" && (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {formatInTz(startDate, "MMM d, yyyy", timezone)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => date && setStartDate(date)}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {formatInTz(endDate, "MMM d, yyyy", timezone)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => date && setEndDate(date)}
                    />
                  </PopoverContent>
                </Popover>
                <Button size="sm" onClick={handleCustomDateChange} disabled={isLoading}>
                  Apply
                </Button>
              </div>
            )}
            </div>

            {/* Export Button */}
            <ExportButtons data={data} startDate={startDate} endDate={endDate} timezone={timezone} />
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${canViewProfit ? "xl:grid-cols-6" : ""}`}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtCurrency(data.totals.revenue)}</div>
            <p className="text-xs text-muted-foreground">
              {data.totals.sales} sales
            </p>
          </CardContent>
        </Card>

        {canViewProfit && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">COGS</CardTitle>
                <PiggyBank className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtCurrency(data.totals.cost ?? 0)}</div>
                <p className="text-xs text-muted-foreground">
                  Cost of goods sold
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Gross Profit</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${(data.totals.grossProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {fmtCurrency(data.totals.grossProfit ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.totals.profitMargin ?? 0}% margin
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expenses</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {fmtCurrency(data.totals.expenses)}
            </div>
            <p className="text-xs text-muted-foreground">
              Operating expenses
            </p>
          </CardContent>
        </Card>

        {canViewProfit && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(data.totals.netProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {fmtCurrency(data.totals.netProfit ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                After all expenses
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Appointments</CardTitle>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.appointments}</div>
            <p className="text-xs text-muted-foreground">
              {data.totals.newClients} new clients
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Missing Cost Warning */}
      {canViewProfit && (data.missingCostCount ?? 0) > 0 && (
        <Alert variant="default" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>Incomplete cost data</strong> — {data.missingCostCount} of {data.totalItemCount} items sold in this period don&apos;t have costs configured. Profit and margin figures may be higher than actual.{" "}
            <Link href="/dashboard/services" className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100">
              Configure service costs &rarr;
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Revenue/Profit Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{canViewProfit ? "Revenue, Cost, Profit & Expenses" : "Revenue & Expenses"}</CardTitle>
          <CardDescription>{canViewProfit ? "Daily revenue, COGS, gross profit, and expenses" : "Daily revenue and expenses"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {data.revenueByDay.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenueByDay}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    {canViewProfit && (
                      <>
                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </>
                    )}
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => formatInTz(value, "MMM d", timezone)}
                    className="text-xs"
                  />
                  <YAxis
                    tickFormatter={(value) => fmtCurrency(value)}
                    className="text-xs"
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels: Record<string, string> = {
                        revenue: "Revenue",
                        cost: "COGS",
                        profit: "Gross Profit",
                        expenses: "Expenses",
                      };
                      return [fmtCurrency(value as number), labels[name as string] || name];
                    }}
                    labelFormatter={(label) => formatInTz(label as string, "MMM d, yyyy", timezone)}
                  />
                  <Legend
                    formatter={(value) => {
                      const labels: Record<string, string> = {
                        revenue: "Revenue",
                        cost: "COGS",
                        profit: "Gross Profit",
                        expenses: "Expenses",
                      };
                      return labels[value] || value;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#8b5cf6"
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                  />
                  {canViewProfit && (
                    <>
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="#f59e0b"
                        fillOpacity={1}
                        fill="url(#colorCost)"
                      />
                      <Area
                        type="monotone"
                        dataKey="profit"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorProfit)"
                      />
                    </>
                  )}
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke="#ef4444"
                    fillOpacity={1}
                    fill="url(#colorExpenses)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue by Item */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Item</CardTitle>
            <CardDescription>Top performing services &amp; products</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {data.revenueByItem.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.revenueByItem}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, payload }) => `${name} (${payload?.percentage || 0}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="revenue"
                      nameKey="item"
                    >
                      {data.revenueByItem.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => fmtCurrency(value as number)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No item data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profitability by Item (owner only) */}
        {canViewProfit ? (
          <Card>
            <CardHeader>
              <CardTitle>Profitability by Item</CardTitle>
              <CardDescription>Revenue vs cost per service/product</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {data.revenueByItem.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.revenueByItem} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tickFormatter={(value) => fmtCurrency(value)} />
                      <YAxis dataKey="item" type="category" width={120} className="text-xs" />
                      <Tooltip
                        formatter={(value, name) => {
                          const labels: Record<string, string> = {
                            revenue: "Revenue",
                            cost: "Cost",
                            profit: "Profit",
                          };
                          return [fmtCurrency(value as number), labels[name as string] || name];
                        }}
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="#8b5cf6" name="Revenue" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="cost" fill="#f59e0b" name="Cost" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="profit" fill="#10b981" name="Profit" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No item data for this period
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Appointments by Status</CardTitle>
              <CardDescription>Breakdown of appointment outcomes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {data.appointmentsByStatus.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.appointmentsByStatus} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" />
                      <YAxis
                        dataKey="status"
                        type="category"
                        width={100}
                        tickFormatter={(value) => value.toLowerCase().replace("_", " ")}
                        className="text-xs capitalize"
                      />
                      <Tooltip />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {data.appointmentsByStatus.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={STATUS_COLORS[entry.status] || COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No appointment data for this period
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Appointments by Status (shown separately for owners since profitability chart takes its grid slot) */}
      {canViewProfit && (
        <Card>
            <CardHeader>
              <CardTitle>Appointments by Status</CardTitle>
              <CardDescription>Breakdown of appointment outcomes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {data.appointmentsByStatus.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.appointmentsByStatus} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" />
                      <YAxis
                        dataKey="status"
                        type="category"
                        width={100}
                        tickFormatter={(value) => value.toLowerCase().replace("_", " ")}
                        className="text-xs capitalize"
                      />
                      <Tooltip />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {data.appointmentsByStatus.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={STATUS_COLORS[entry.status] || COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No appointment data for this period
                  </div>
                )}
              </div>
            </CardContent>
        </Card>
      )}

      {/* Expenses by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Expenses by Category</CardTitle>
          <CardDescription>Breakdown of expenses for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {data.expensesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.expensesByCategory}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, payload }) => {
                      const total = data.totals.expenses;
                      const pct = total > 0 ? Math.round((payload.amount / total) * 100) : 0;
                      return `${name} (${pct}%)`;
                    }}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="amount"
                    nameKey="category"
                  >
                    {data.expensesByCategory.map((entry, index) => (
                      <Cell key={`cell-exp-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmtCurrency(value as number)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No expense data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Client Profitability (owner only) */}
      {canViewProfit && data.profitByClient && data.profitByClient.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Client Profitability</CardTitle>
            <CardDescription>Top clients by profit contribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.profitByClient} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tickFormatter={(value) => fmtCurrency(value)} />
                  <YAxis dataKey="client" type="category" width={130} className="text-xs" />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels: Record<string, string> = {
                        revenue: "Revenue",
                        cost: "Cost",
                        profit: "Profit",
                      };
                      return [fmtCurrency(value as number), labels[name as string] || name];
                    }}
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="#8b5cf6" name="Revenue" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="profit" fill="#10b981" name="Profit" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Staff Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Performance</CardTitle>
          <CardDescription>{canViewProfit ? "Revenue, profit, and service count by staff member" : "Revenue and service count by staff member"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {data.revenueByStaff.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueByStaff}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="staff" className="text-xs" />
                  <YAxis tickFormatter={(value) => fmtCurrency(value)} />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels: Record<string, string> = {
                        revenue: "Revenue",
                        profit: "Profit",
                        appointments: "Items",
                      };
                      if (name === "appointments") return [value, labels[name as string] || name];
                      return [fmtCurrency(value as number), labels[name as string] || name];
                    }}
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="#8b5cf6" name="Revenue" radius={[4, 4, 0, 0]} />
                  {canViewProfit && (
                    <Bar dataKey="profit" fill="#10b981" name="Profit" radius={[4, 4, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No staff performance data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Peak Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Peak Hours</CardTitle>
          <CardDescription>Most popular appointment times</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            {data.peakHours.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={(hour) => `${hour}:00`}
                    className="text-xs"
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(hour) => `${hour}:00 - ${Number(hour) + 1}:00`}
                    formatter={(value) => [value, "Appointments"]}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No peak hours data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
