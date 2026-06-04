"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SalonImpersonationActions } from "@/components/admin/salon-impersonation-actions";
import type { SalonListItem } from "@/lib/actions/salon";

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

export function SalonAdminTable({ salons }: { salons: SalonListItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return salons;
    return salons.filter(
      (s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)
    );
  }, [salons, query]);

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
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No salons match “{query}”.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((salon) => (
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
    </div>
  );
}
