"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  MoreVertical,
  XCircle,
  Banknote,
} from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { PayrollRunListItem, deletePayrollRun, cancelPayrollRun } from "@/lib/actions/payroll";
import { formatCurrency } from "@/lib/utils/currency";
import { PayrollRunStatus } from "@prisma/client";

interface PayrollRunListProps {
  runs: PayrollRunListItem[];
  page: number;
  totalPages: number;
  total: number;
  canManage?: boolean;
  canDelete?: boolean;
  currencyCode?: string;
  timezone?: string;
}

function getStatusBadge(status: PayrollRunStatus) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="outline">Draft</Badge>;
    case "FINALIZED":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Finalized</Badge>;
    case "PAID":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
    case "CANCELLED":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function PayrollRunList({
  runs,
  page,
  totalPages,
  total,
  canManage = false,
  canDelete = false,
  currencyCode = "USD",
  timezone = "UTC",
}: PayrollRunListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    startTransition(() => {
      router.push(`/dashboard/payroll?${params.toString()}`);
    });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const result = await deletePayrollRun(deleteId);
      if (result.success) {
        toast.success("Payroll run deleted");
        setDeleteId(null);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to delete payroll run");
    }
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    try {
      const result = await cancelPayrollRun(cancelId);
      if (result.success) {
        toast.success("Payroll run cancelled");
        setCancelId(null);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to cancel payroll run");
    }
  };

  if (runs.length === 0) {
    return (
      <div className="text-center py-12">
        <Banknote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">No payroll runs found</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Staff</TableHead>
              <TableHead className="text-right">Net Pay</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Created</TableHead>
              {(canManage || canDelete) && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow
                key={run.id}
                className="cursor-pointer"
                onClick={() => router.push(`/dashboard/payroll/${run.id}`)}
              >
                <TableCell className="whitespace-nowrap font-medium">
                  {formatInTz(run.periodStart, "MMM d", timezone)} -{" "}
                  {formatInTz(run.periodEnd, "MMM d, yyyy", timezone)}
                </TableCell>
                <TableCell>{getStatusBadge(run.status)}</TableCell>
                <TableCell className="text-center">{run._count.entries}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(Number(run.totalNetPay), currencyCode)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {run.salon.name}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatInTz(run.createdAt, "MMM d, yyyy", timezone)}
                </TableCell>
                {(canManage || canDelete) && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => router.push(`/dashboard/payroll/${run.id}`)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        {canManage && (run.status === "DRAFT" || run.status === "FINALIZED") && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setCancelId(run.id)}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel Run
                            </DropdownMenuItem>
                          </>
                        )}
                        {canDelete && (run.status === "DRAFT" || run.status === "CANCELLED") && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteId(run.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, total)} of {total} runs
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || isPending}
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
              disabled={page >= totalPages || isPending}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The payroll run and all its entries will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirmation */}
      <AlertDialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the payroll run and all its entries. This action can be reversed by deleting and recreating the run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Run</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
