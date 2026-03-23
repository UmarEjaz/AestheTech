"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BranchFilterProps {
  currentFilter: "current" | "all";
  currentSalonName?: string;
}

export function BranchFilter({ currentFilter, currentSalonName }: BranchFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "current") {
      params.delete("branch");
    } else {
      params.set("branch", value);
    }
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={currentFilter} onValueChange={handleChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="current">
            {currentSalonName || "Current Branch"}
          </SelectItem>
          <SelectItem value="all">All Branches</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
