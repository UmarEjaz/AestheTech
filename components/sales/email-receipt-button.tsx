"use client";

import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { sendReceiptEmail, sendInvoiceEmail } from "@/lib/actions/email";

interface EmailReceiptButtonProps {
  saleId: string;
  clientEmail: string | null;
  variant?: "default" | "outline" | "ghost";
}

export function EmailReceiptButton({
  saleId,
  clientEmail,
  variant = "outline",
}: EmailReceiptButtonProps) {
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!clientEmail) {
      toast.error("Client has no email address on file");
      return;
    }

    setIsSending(true);
    try {
      const result = await sendReceiptEmail(saleId);
      if (result.success) {
        toast.success(`Receipt sent to ${clientEmail}`);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to send receipt email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button
      variant={variant}
      onClick={handleSend}
      disabled={isSending || !clientEmail}
      title={!clientEmail ? "Client has no email address" : `Send receipt to ${clientEmail}`}
    >
      {isSending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Mail className="h-4 w-4 mr-2" />
      )}
      {isSending ? "Sending..." : "Email Receipt"}
    </Button>
  );
}

interface EmailInvoiceButtonProps {
  saleId: string;
  clientEmail: string | null;
  variant?: "default" | "outline" | "ghost";
}

export function EmailInvoiceButton({
  saleId,
  clientEmail,
  variant = "outline",
}: EmailInvoiceButtonProps) {
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!clientEmail) {
      toast.error("Client has no email address on file");
      return;
    }

    setIsSending(true);
    try {
      const result = await sendInvoiceEmail(saleId);
      if (result.success) {
        toast.success(`Invoice sent to ${clientEmail}`);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to send invoice email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button
      variant={variant}
      onClick={handleSend}
      disabled={isSending || !clientEmail}
      title={!clientEmail ? "Client has no email address" : `Send invoice to ${clientEmail}`}
    >
      {isSending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Mail className="h-4 w-4 mr-2" />
      )}
      {isSending ? "Sending..." : "Email Invoice"}
    </Button>
  );
}
