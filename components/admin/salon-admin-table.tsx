"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { SalonImpersonationActions } from "@/components/admin/salon-impersonation-actions";
import { getSalons, type SalonListItem } from "@/lib/actions/salon";

function statusVariant(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "TRIAL":
      return "warning" as const;
    case "SUSPENDED":
    case "CANCELLED":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

interface SalonAdminTableProps {
  initialSalons: SalonListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  pageSize: number;
}

export function SalonAdminTable({
  initialSalons,
  initialTotal,
  initialPage,
  initialTotalPages,
  pageSize,
}: SalonAdminTableProps) {
  const [salons, setSalons] = useState(initialSalons);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [query, setQuery] = useState("");
  const [perPage, setPerPage] = useState(pageSize);
  const [loading, setLoading] = useState(false);
  const firstRender = useRef(true);

  async function load(q: string, p: number, size: number = perPage) {
    setLoading(true);
    const res = await getSalons({ query: q.trim() || undefined, page: p, limit: size });
    if (res.success) {
      setSalons(res.data.salons);
      setTotal(res.data.total);
      setPage(res.data.page);
      setTotalPages(res.data.totalPages);
    }
    setLoading(false);
  }

  // Debounce search; reset to page 1 whenever the query changes. Skip the first run
  // so the server-rendered initial page isn't immediately re-fetched.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => load(query, 1), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search salons by name or slug…"
          className="pl-9"
          aria-label="Search salons"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} total {total === 1 ? "salon" : "salons"} • Page {page} of {totalPages || 1}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Per page</span>
          <Select
            value={perPage.toString()}
            onValueChange={(v) => {
              const n = parseInt(v, 10);
              setPerPage(n);
              load(query, 1, n);
            }}
          >
            <SelectTrigger className="w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Slug</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Plan</TableHead>
            <TableHead className="hidden md:table-cell">Staff</TableHead>
            <TableHead className="hidden lg:table-cell">Created</TableHead>
            <TableHead className="text-right">Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {salons.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                {query.trim() ? `No salons match “${query}”.` : "No salons found."}
              </TableCell>
            </TableRow>
          ) : (
            salons.map((salon) => (
              <TableRow key={salon.id}>
                <TableCell>
                  <Link
                    href={`/admin/salons/${salon.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {salon.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground font-mono text-sm">
                  {salon.slug}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(salon.subscriptionStatus)}>
                    {salon.subscriptionStatus}
                  </Badge>
                  {!salon.isActive && (
                    <Badge variant="destructive" className="ml-1">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {salon.subscriptionPlan ?? <span className="text-muted-foreground">--</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell">{salon._count.users}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {new Date(salon.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <SalonImpersonationActions
                    salonId={salon.id}
                    salonName={salon.name}
                    variant="row"
                    disabled={!salon.isActive}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {from} to {to} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(query, page - 1)}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(query, page + 1)}
              disabled={page >= totalPages || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
