"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateOnly } from "@/lib/utils/timezone";
import { Edit, MoreVertical, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { SalaryConfigListItem, deleteSalaryConfig } from "@/lib/actions/salary-config";
import { formatCurrency } from "@/lib/utils/currency";

interface SalaryConfigListProps {
  configs: SalaryConfigListItem[];
  canManage?: boolean;
  currencyCode?: string;
}

export function SalaryConfigList({
  configs,
  canManage = false,
  currencyCode = "USD",
}: SalaryConfigListProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      const result = await deleteSalaryConfig(id);
      if (result.success) {
        toast.success("Salary configuration updated");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to update salary configuration");
    } finally {
      setTogglingId(null);
    }
  };

  if (configs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No salary configurations found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Staff Member</TableHead>
            <TableHead>Pay Type</TableHead>
            <TableHead className="text-right">Base Rate</TableHead>
            <TableHead>Effective Date</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Status</TableHead>
            {canManage && <TableHead className="w-[50px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map((config) => (
            <TableRow key={config.id} className={!config.isActive ? "opacity-50" : ""}>
              <TableCell className="font-medium">
                {config.user.firstName} {config.user.lastName}
                <p className="text-xs text-muted-foreground">{config.user.email}</p>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{config.payType}</Badge>
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatCurrency(Number(config.baseRate), currencyCode)}
                {config.payType === "HOURLY" && <span className="text-muted-foreground">/hr</span>}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateOnly(config.effectiveDate, "MMM d, yyyy")}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {config.salon.name}
              </TableCell>
              <TableCell>
                {config.isActive ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </TableCell>
              {canManage && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          startTransition(() => {
                            router.push(`/dashboard/payroll/salary-config/${config.id}/edit`);
                          })
                        }
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleToggle(config.id)}
                        disabled={togglingId === config.id}
                      >
                        {config.isActive ? (
                          <>
                            <ToggleLeft className="mr-2 h-4 w-4" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <ToggleRight className="mr-2 h-4 w-4" />
                            Reactivate
                          </>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
