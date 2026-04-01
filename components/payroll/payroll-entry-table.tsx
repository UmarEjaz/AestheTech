"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { PayrollEntryItem, updatePayrollEntry } from "@/lib/actions/payroll";
import { formatCurrency } from "@/lib/utils/currency";
import { PayrollEntryStatus, PayrollRunStatus } from "@prisma/client";

interface PayrollEntryTableProps {
  entries: PayrollEntryItem[];
  runStatus: PayrollRunStatus;
  currencyCode?: string;
}

type EditedEntry = {
  basePay: number;
  bonus: number;
  deductions: number;
  deductionNotes: string;
  notes: string;
};

function getEntryStatusBadge(status: PayrollEntryStatus) {
  switch (status) {
    case "PENDING":
      return <Badge variant="outline">Pending</Badge>;
    case "PAID":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
    case "ON_HOLD":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">On Hold</Badge>;
    case "CANCELLED":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function PayrollEntryTable({
  entries,
  runStatus,
  currencyCode = "USD",
}: PayrollEntryTableProps) {
  const isDraft = runStatus === "DRAFT";
  const [editedEntries, setEditedEntries] = useState<Record<string, EditedEntry>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const getEntryValues = (entry: PayrollEntryItem): EditedEntry => {
    return (
      editedEntries[entry.id] || {
        basePay: Number(entry.basePay),
        bonus: Number(entry.bonus),
        deductions: Number(entry.deductions),
        deductionNotes: entry.deductionNotes || "",
        notes: entry.notes || "",
      }
    );
  };

  const updateField = (entryId: string, field: keyof EditedEntry, value: string | number) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const current = getEntryValues(entry);
    setEditedEntries((prev) => ({
      ...prev,
      [entryId]: { ...current, [field]: value },
    }));
  };

  const calculateNetPay = (entry: PayrollEntryItem): number => {
    const values = getEntryValues(entry);
    return values.basePay + values.bonus - values.deductions;
  };

  const hasChanges = (entry: PayrollEntryItem): boolean => {
    return !!editedEntries[entry.id];
  };

  const handleSave = async (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const values = getEntryValues(entry);
    setSavingId(entryId);

    try {
      const result = await updatePayrollEntry({
        id: entryId,
        basePay: values.basePay,
        bonus: values.bonus,
        deductions: values.deductions,
        deductionNotes: values.deductionNotes,
        notes: values.notes,
      });

      if (result.success) {
        toast.success(`Updated entry for ${entry.user.firstName} ${entry.user.lastName}`);
        setEditedEntries((prev) => {
          const next = { ...prev };
          delete next[entryId];
          return next;
        });
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to save entry");
    } finally {
      setSavingId(null);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No entries in this payroll run</p>
      </div>
    );
  }

  // Calculate totals
  const totalBasePay = entries.reduce((sum, e) => sum + (editedEntries[e.id]?.basePay ?? Number(e.basePay)), 0);
  const totalBonus = entries.reduce((sum, e) => sum + (editedEntries[e.id]?.bonus ?? Number(e.bonus)), 0);
  const totalDeductions = entries.reduce((sum, e) => sum + (editedEntries[e.id]?.deductions ?? Number(e.deductions)), 0);
  const totalNetPay = entries.reduce((sum, e) => sum + calculateNetPay(e), 0);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Staff Member</TableHead>
            <TableHead className="text-right">Base Pay</TableHead>
            <TableHead className="text-right">Bonus</TableHead>
            <TableHead className="text-right">Deductions</TableHead>
            {isDraft && <TableHead>Deduction Notes</TableHead>}
            <TableHead className="text-right">Net Pay</TableHead>
            <TableHead>Status</TableHead>
            {isDraft && <TableHead className="w-[80px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const values = getEntryValues(entry);
            const netPay = calculateNetPay(entry);

            return (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">
                  {entry.user.firstName} {entry.user.lastName}
                </TableCell>
                <TableCell className="text-right">
                  {isDraft ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={values.basePay}
                      onChange={(e) => updateField(entry.id, "basePay", parseFloat(e.target.value) || 0)}
                      className="w-28 text-right ml-auto"
                    />
                  ) : (
                    formatCurrency(Number(entry.basePay), currencyCode)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isDraft ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={values.bonus}
                      onChange={(e) => updateField(entry.id, "bonus", parseFloat(e.target.value) || 0)}
                      className="w-28 text-right ml-auto"
                    />
                  ) : (
                    formatCurrency(Number(entry.bonus), currencyCode)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isDraft ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={values.deductions}
                      onChange={(e) => updateField(entry.id, "deductions", parseFloat(e.target.value) || 0)}
                      className="w-28 text-right ml-auto"
                    />
                  ) : (
                    formatCurrency(Number(entry.deductions), currencyCode)
                  )}
                </TableCell>
                {isDraft && (
                  <TableCell>
                    <Input
                      type="text"
                      value={values.deductionNotes}
                      onChange={(e) => updateField(entry.id, "deductionNotes", e.target.value)}
                      placeholder="e.g. Tax: 500"
                      className="w-40"
                    />
                  </TableCell>
                )}
                <TableCell className="text-right font-bold">
                  {formatCurrency(isDraft ? netPay : Number(entry.netPay), currencyCode)}
                </TableCell>
                <TableCell>{getEntryStatusBadge(entry.status)}</TableCell>
                {isDraft && (
                  <TableCell>
                    {hasChanges(entry) && (
                      <Button
                        size="sm"
                        onClick={() => handleSave(entry.id)}
                        disabled={savingId === entry.id}
                      >
                        {savingId === entry.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {/* Totals row */}
          <TableRow className="bg-muted/50 font-bold">
            <TableCell>Total ({entries.length} staff)</TableCell>
            <TableCell className="text-right">{formatCurrency(totalBasePay, currencyCode)}</TableCell>
            <TableCell className="text-right">{formatCurrency(totalBonus, currencyCode)}</TableCell>
            <TableCell className="text-right">{formatCurrency(totalDeductions, currencyCode)}</TableCell>
            {isDraft && <TableCell />}
            <TableCell className="text-right">{formatCurrency(totalNetPay, currencyCode)}</TableCell>
            <TableCell />
            {isDraft && <TableCell />}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
