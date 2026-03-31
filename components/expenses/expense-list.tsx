"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import {
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  MoreVertical,
  RefreshCw,
  Receipt,
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
import { ExpenseListItem, deleteExpense } from "@/lib/actions/expense";
import { formatCurrency } from "@/lib/utils/currency";

interface ExpenseListProps {
  expenses: ExpenseListItem[];
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  canManage?: boolean;
  canDelete?: boolean;
  currencyCode?: string;
  timezone?: string;
}

export function ExpenseList({
  expenses,
  page,
  totalPages,
  total,
  pageSize = 20,
  canManage = false,
  canDelete = false,
  currencyCode = "USD",
  timezone = "UTC",
}: ExpenseListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    startTransition(() => {
      router.push(`/dashboard/expenses?${params.toString()}`);
    });
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    const result = await deleteExpense(deleteId);
    if (result.success) {
      toast.success("Expense deleted successfully");
      setDeleteId(null);
    } else {
      toast.error(result.error);
    }
  };

  if (expenses.length === 0) {
    return (
      <div className="text-center py-12">
        <Receipt className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">No expenses found</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {(canManage || canDelete) && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell className="whitespace-nowrap">
                  {formatInTz(expense.date, "MMM d, yyyy", timezone)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {expense.category.color && (
                      <span
                        className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: expense.category.color }}
                      />
                    )}
                    <span>{expense.category.name}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-[200px] truncate">
                  <div className="flex items-center gap-2">
                    {expense.description || "-"}
                    {expense.isRecurring && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <RefreshCw className="h-3 w-3" />
                        Recurring
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {expense.salon.name}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {expense.createdBy.firstName} {expense.createdBy.lastName}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(Number(expense.amount), currencyCode)}
                </TableCell>
                {(canManage || canDelete) && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canManage && (
                          <DropdownMenuItem
                            onClick={() => router.push(`/dashboard/expenses/${expense.id}/edit`)}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            {canManage && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteId(expense.id)}
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
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} expenses
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The expense record will be permanently removed.
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
    </>
  );
}
