"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import {
  Search,
  Plus,
  Eye,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Loader2,
  Calendar,
  DollarSign,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SaleListItem } from "@/lib/actions/sale";

interface SalesTableProps {
  initialSales: SaleListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  canCreate?: boolean;
  currencySymbol: string;
  timezone: string;
  todaysSalesCount: number;
  todaysRevenue: number;
  fetchSales: (params: {
    query?: string;
    page?: number;
    limit?: number;
  }) => Promise<{
    success: boolean;
    data?: {
      sales: SaleListItem[];
      total: number;
      page: number;
      totalPages: number;
    };
    error?: string;
  }>;
}

export function SalesTable({
  initialSales,
  initialTotal,
  initialPage,
  initialTotalPages,
  canCreate = false,
  currencySymbol,
  timezone,
  todaysSalesCount,
  todaysRevenue,
  fetchSales,
}: SalesTableProps) {
  const router = useRouter();
  const [sales, setSales] = useState<SaleListItem[]>(initialSales);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Today's stats come from server-side aggregation (props) for accuracy across all pages

  const loadSales = useCallback(async (search: string, pageNum: number) => {
    setLoading(true);
    try {
      const result = await fetchSales({
        query: search || undefined,
        page: pageNum,
        limit: 15,
      });

      if (result.success && result.data) {
        setSales(result.data.sales);
        setTotal(result.data.total);
        setPage(result.data.page);
        setTotalPages(result.data.totalPages);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchSales]);

  // Debounced search
  const debouncedSearch = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      loadSales(value, 1);
    }, 400);
  }, [loadSales]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);

    if (value.trim() === "") {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      loadSales("", 1);
    } else {
      debouncedSearch(value);
    }
  };

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    loadSales(searchTerm, newPage);
  };

  const getInitials = (firstName: string, lastName: string | null) => {
    return `${firstName[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  const getStatusBadge = (sale: SaleListItem) => {
    if (sale.invoice) {
      switch (sale.invoice.status) {
        case "PAID":
          return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
        case "PENDING":
          return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</Badge>;
        case "OVERDUE":
          return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Overdue</Badge>;
        case "CANCELLED":
          return <Badge variant="secondary">Cancelled</Badge>;
      }
    }
    return <Badge variant="outline">Draft</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Receipt className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Total Sales</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium">Today&apos;s Sales</p>
                <p className="text-2xl font-bold">{todaysSalesCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium">Today&apos;s Revenue</p>
                <p className="text-2xl font-bold">{currencySymbol}{todaysRevenue.toFixed(2)}</p>

              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by client name, phone, or invoice..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
            {canCreate && (
              <Button onClick={() => router.push("/dashboard/sales/new")}>
                <Plus className="h-4 w-4 mr-2" />
                New Sale
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sales History</CardTitle>
          <CardDescription>
            {total} total sales - Page {page} of {totalPages || 1}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No sales found</h3>
                    <p className="text-muted-foreground mb-4">
                      {searchTerm
                        ? "No sales match your search criteria."
                        : "Get started by creating your first sale."}
                    </p>
                    {canCreate && (
                      <Button onClick={() => router.push("/dashboard/sales/new")}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create First Sale
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                sales.map((sale) => (
                  <TableRow
                    key={sale.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/dashboard/sales/${sale.id}`)}
                  >
                    <TableCell>
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-purple-100 text-purple-600">
                          {getInitials(sale.client.firstName, sale.client.lastName)}
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {sale.client.firstName} {sale.client.lastName}
                          </p>
                          {sale.client.isWalkIn && (
                            <Badge variant="outline" className="text-xs">
                              Walk-in
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {sale.client.phone || <span className="italic">No phone</span>}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {sale.invoice ? (
                        <span className="font-mono text-sm">{sale.invoice.invoiceNumber}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[150px]">
                        {sale.items.slice(0, 2).map((item, idx) => (
                          <p key={idx} className="text-sm truncate">
                            {item.service?.name || item.product?.name || "Unknown"}
                          </p>
                        ))}
                        {sale.items.length > 2 && (
                          <p className="text-xs text-muted-foreground">
                            +{sale.items.length - 2} more
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {sale.staff.firstName} {sale.staff.lastName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-purple-600">
                          {currencySymbol}{Number(sale.finalAmount).toFixed(2)}
                        </p>
                        {Number(sale.discount) > 0 && (
                          <p className="text-xs text-green-600">
                            -{currencySymbol}{Number(sale.discount).toFixed(2)} discount
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(sale)}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatInTz(sale.createdAt, "MMM d, yyyy", timezone)}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {formatInTz(sale.createdAt, "h:mm a", timezone)}
                      </p>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => router.push(`/dashboard/sales/${sale.id}`)}
                        title="View sale"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * 15 + 1} to {Math.min(page * 15, total)} of{" "}
                {total} sales
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || loading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
