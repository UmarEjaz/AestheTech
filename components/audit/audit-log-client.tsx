"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Role } from "@prisma/client";

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userRole: string;
  details: unknown;
  createdAt: Date;
  user: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface AuditLogClientProps {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  entityTypes: string[];
  staff: { id: string; firstName: string; lastName: string; role: Role }[];
  filters: {
    action?: string;
    entityType?: string;
    userId?: string;
    from?: string;
    to?: string;
  };
}

const ACTION_COLORS: Record<string, string> = {
  CREATED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  UPDATED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  DELETED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  COMPLETED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  CANCELLED: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  REFUND: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  SENT: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  CHANGED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  RESTORED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function getActionBadgeColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "-";
  const entries = Object.entries(details as Record<string, unknown>);
  if (entries.length === 0) return "-";
  return entries
    .map(([key, value]) => {
      if (typeof value === "object" && value !== null && "from" in value && "to" in value) {
        const v = value as { from: string; to: string };
        return `${key}: ${v.from} → ${v.to}`;
      }
      return `${key}: ${String(value)}`;
    })
    .join(", ");
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function AuditLogClient({
  logs,
  total,
  page,
  pageSize,
  actions,
  entityTypes,
  staff,
  filters,
}: AuditLogClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateFilter = (key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    router.push(`/dashboard/audit-log?${params.toString()}`);
  };

  const clearFilters = () => {
    router.push("/dashboard/audit-log");
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    router.push(`/dashboard/audit-log?${params.toString()}`);
  };

  const hasActiveFilters = filters.action || filters.entityType || filters.userId || filters.from || filters.to;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-purple-600" />
          Audit Log
        </h1>
        <p className="text-muted-foreground mt-1">
          Track all actions performed across the system ({total} entries)
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Select
              value={filters.action || "all"}
              onValueChange={(v) => updateFilter("action", v === "all" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {formatAction(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.entityType || "all"}
              onValueChange={(v) => updateFilter("entityType", v === "all" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Entity Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entityTypes.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.userId || "all"}
              onValueChange={(v) => updateFilter("userId", v === "all" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={filters.from || ""}
              onChange={(e) => updateFilter("from", e.target.value || undefined)}
              placeholder="From date"
            />

            <Input
              type="date"
              value={filters.to || ""}
              onChange={(e) => updateFilter("to", e.target.value || undefined)}
              placeholder="To date"
            />
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="mt-2 text-muted-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-0">
          <CardDescription>
            {total === 0
              ? "No entries"
              : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No audit log entries found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {log.user ? `${log.user.firstName} ${log.user.lastName}` : "Deleted user"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.userRole}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getActionBadgeColor(log.action)}>
                        {formatAction(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{log.entityType}</span>
                      {log.entityId && (
                        <span className="text-xs text-muted-foreground block font-mono truncate max-w-[120px]">
                          {log.entityId}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[300px] truncate text-sm text-muted-foreground">
                      {formatDetails(log.details)}
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
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
