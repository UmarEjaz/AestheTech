"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import { Search, Eye, ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceListItem } from "@/lib/actions/invoice";
import { InvoiceSearchParams } from "@/lib/validations/invoice";
import { formatCurrency } from "@/lib/utils/currency";
import { amountDue, formatInvoiceStatus } from "@/lib/utils/invoice-status";

const STATUSES = ["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "REFUNDED"] as const;
type StatusFilter = "ALL" | (typeof STATUSES)[number];

function statusVariant(status: string) {
  switch (status) {
    case "PAID":
      return "success" as const;
    case "PENDING":
    case "PARTIALLY_PAID":
      return "warning" as const;
    case "OVERDUE":
      return "destructive" as const;
    default:
      return "secondary" as const; // CANCELLED, REFUNDED
  }
}

interface InvoiceTableProps {
  initialInvoices: InvoiceListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  currencyCode: string;
  timezone: string;
  fetchInvoices: (params: InvoiceSearchParams) => Promise<{
    success: boolean;
    data?: {
      invoices: InvoiceListItem[];
      total: number;
      page: number;
      totalPages: number;
    };
    error?: string;
  }>;
}

export function InvoiceTable({
  initialInvoices,
  initialTotal,
  initialPage,
  initialTotalPages,
  currencyCode,
  timezone,
  fetchInvoices,
}: InvoiceTableProps) {
  const router = useRouter();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [isLoading, setIsLoading] = useState(false);
  const isFirstRender = useRef(true);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (nextPage: number, q: string, s: StatusFilter) => {
      const seq = ++requestSeq.current;
      setIsLoading(true);
      try {
        const res = await fetchInvoices({
          page: nextPage,
          limit: 15,
          ...(q.trim() && { query: q.trim() }),
          ...(s !== "ALL" && { status: s }),
        });
        // Ignore stale responses (a newer request started after this one).
        if (seq !== requestSeq.current) return;
        if (res.success && res.data) {
          setInvoices(res.data.invoices);
          setTotal(res.data.total);
          setPage(res.data.page);
          setTotalPages(res.data.totalPages);
        }
      } finally {
        if (seq === requestSeq.current) setIsLoading(false);
      }
    },
    [fetchInvoices]
  );

  // Debounced reload on search/filter change (skip the initial mount).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const t = setTimeout(() => load(1, query, status), 300);
    return () => clearTimeout(t);
  }, [query, status, load]);

  return (
    <div className="space-y-4">
      {/* Search + filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by invoice #, client name, or phone…"
            className="pl-9"
            aria-label="Search invoices"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {formatInvoiceStatus(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    {inv.invoiceNumber}
                  </TableCell>
                  <TableCell>
                    {inv.client.firstName} {inv.client.lastName ?? ""}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {formatInTz(inv.createdAt, "dd MMM yyyy", timezone)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(inv.status)}>{formatInvoiceStatus(inv.status)}</Badge>
                    {inv.dueDate && (inv.status === "PENDING" || inv.status === "PARTIALLY_PAID" || inv.status === "OVERDUE") && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Due {formatInTz(inv.dueDate, "dd MMM yyyy", timezone)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(inv.total), currencyCode)}
                    {(inv.status === "PENDING" || inv.status === "PARTIALLY_PAID" || inv.status === "OVERDUE") && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {formatCurrency(amountDue(Number(inv.total), inv.payments), currencyCode)} due
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/dashboard/invoices/${inv.id}`}>
                        <Eye className="h-4 w-4" />
                        <span className="sr-only">View invoice {inv.invoiceNumber}</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} invoice{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => load(page - 1, query, status)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => load(page + 1, query, status)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
