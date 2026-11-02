"use client";

import type { ReactElement } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Printer } from "lucide-react";
import {
  RECEIPT_SIZES,
  RECEIPT_SIZE_LABELS,
  RECEIPT_SIZE_HINTS,
  asReceiptSize,
  type ReceiptSize,
} from "@/lib/constants/receipt-sizes";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReceiptSettingsCardProps {
  canManage: boolean;
  receiptSize: ReceiptSize;
  onReceiptSizeChange: (size: ReceiptSize) => void;
  /** `register("receiptFooter")` from the parent form. */
  footerField: UseFormRegisterReturn;
  footerError?: string;
}

/** The "Receipts" card of the Settings form: paper size for printed/downloaded receipts + footer note. */
export function ReceiptSettingsCard({
  canManage,
  receiptSize,
  onReceiptSizeChange,
  footerField,
  footerError,
}: ReceiptSettingsCardProps): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" />
          Receipts
        </CardTitle>
        <CardDescription>
          The paper size for printed and downloaded customer receipts, and an optional note at the foot
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="receiptSize">Receipt size</Label>
          <Select
            value={receiptSize}
            onValueChange={(value) => onReceiptSizeChange(asReceiptSize(value))}
            disabled={!canManage}
          >
            <SelectTrigger id="receiptSize" aria-describedby="receiptSize-hint" className="w-full sm:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Label only: Radix mirrors an item's children into the closed trigger, so a hint here
                  would be read out as part of the selected value. The hint shows below instead. */}
              {RECEIPT_SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RECEIPT_SIZE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="receiptSize-hint" className="text-sm text-muted-foreground">
            {RECEIPT_SIZE_HINTS[receiptSize]}. Applies to both Print and Download PDF.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="receiptFooter">Footer note (optional)</Label>
          <Textarea
            id="receiptFooter"
            rows={2}
            placeholder="e.g. No refunds after 7 days. Thank you for your visit!"
            {...footerField}
            disabled={!canManage}
          />
          <p className="text-sm text-muted-foreground">
            A short note or terms printed at the foot of sales receipts and invoices. Leave blank for none.
          </p>
          {footerError && <p className="text-sm text-destructive">{footerError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
