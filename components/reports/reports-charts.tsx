"use client";

import { useState } from "react";
import { subDays, startOfMonth, endOfMonth } from "date-fns";
import { formatInTz } from "@/lib/utils/timezone";
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
  Calendar as CalendarIcon,
  DollarSign,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ReportData } from "@/lib/actions/dashboard";
import { ExportButtons } from "./export-buttons";

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

  const formatCurrency = (value: number) => {
    return `${data.currencySymbol}${value.toLocaleString()}`;
  };

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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.totals.revenue)}</div>
            <p className="text-xs text-muted-foreground">
              {data.totals.sales} sales completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Appointments</CardTitle>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.appointments}</div>
            <p className="text-xs text-muted-foreground">
              Total scheduled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.newClients}</div>
            <p className="text-xs text-muted-foreground">
              Joined this period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Sale</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(data.totals.sales > 0 ? data.totals.revenue / data.totals.sales : 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Per transaction
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Over Time</CardTitle>
          <CardDescription>Daily revenue for the selected period</CardDescription>
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
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => formatInTz(value, "MMM d", timezone)}
                    className="text-xs"
                  />
                  <YAxis
                    tickFormatter={(value) => `${data.currencySymbol}${value}`}
                    className="text-xs"
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value as number), "Revenue"]}
                    labelFormatter={(label) => formatInTz(label as string, "MMM d, yyyy", timezone)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#8b5cf6"
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No revenue data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Revenue by Service */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Service</CardTitle>
            <CardDescription>Top performing services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {data.revenueByService.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.revenueByService}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, payload }) => `${name} (${payload?.percentage || 0}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="revenue"
                      nameKey="service"
                    >
                      {data.revenueByService.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No service data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Appointments by Status */}
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
      </div>

      {/* Staff Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Performance</CardTitle>
          <CardDescription>Revenue and appointments by staff member</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {data.revenueByStaff.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueByStaff}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="staff" className="text-xs" />
                  <YAxis yAxisId="left" tickFormatter={(value) => `${data.currencySymbol}${value}`} />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "revenue" ? formatCurrency(value as number) : value
                    }
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="revenue" fill="#8b5cf6" name="Revenue" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="appointments" fill="#06b6d4" name="Services" radius={[4, 4, 0, 0]} />
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
