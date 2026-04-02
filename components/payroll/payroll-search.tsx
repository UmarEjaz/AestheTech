"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon, X } from "lucide-react";
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
import { PayrollRunStatus } from "@prisma/client";

export function PayrollSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selectedStatus = searchParams.get("status") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  const updateUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.set("page", "1");

    startTransition(() => {
      router.push(`/dashboard/payroll?${params.toString()}`);
    });
  };

  const handleClearAll = () => {
    startTransition(() => {
      router.push("/dashboard/payroll");
    });
  };

  const hasFilters = selectedStatus || startDate || endDate;

  const statusLabels: Record<string, string> = {
    DRAFT: "Draft",
    FINALIZED: "Finalized",
    PAID: "Paid",
    CANCELLED: "Cancelled",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select
          value={selectedStatus}
          onValueChange={(value) => updateUrl({ status: value === "ALL" ? "" : value })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {Object.values(PayrollRunStatus).map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabels[status] || status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => updateUrl({ startDate: e.target.value })}
            className="w-[140px]"
            placeholder="From"
            disabled={isPending}
          />
          <span className="text-muted-foreground">-</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => updateUrl({ endDate: e.target.value })}
            className="w-[140px]"
            placeholder="To"
            disabled={isPending}
          />
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {selectedStatus && (
            <Badge variant="secondary" className="gap-1">
              Status: {statusLabels[selectedStatus] || selectedStatus}
              <button
                type="button"
                aria-label="Clear status filter"
                onClick={() => updateUrl({ status: "" })}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {startDate && (
            <Badge variant="secondary" className="gap-1">
              From: {startDate}
              <button
                type="button"
                aria-label="Clear start date filter"
                onClick={() => updateUrl({ startDate: "" })}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {endDate && (
            <Badge variant="secondary" className="gap-1">
              To: {endDate}
              <button
                type="button"
                aria-label="Clear end date filter"
                onClick={() => updateUrl({ endDate: "" })}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
