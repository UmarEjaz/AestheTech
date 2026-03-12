interface ReceiptItem {
  name: string;
  staff?: string;
  price: number;
  quantity: number;
}

interface ReceiptEmailData {
  salonName: string;
  clientName: string;
  invoiceNumber: string;
  date: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currencySymbol: string;
  paymentMethods: string[];
}

interface InvoiceEmailData {
  salonName: string;
  salonAddress?: string | null;
  salonPhone?: string | null;
  salonEmail?: string | null;
  clientName: string;
  clientEmail?: string | null;
  invoiceNumber: string;
  status: string;
  date: string;
  dueDate?: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currencySymbol: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(symbol: string, amount: number): string {
  return `${escapeHtml(symbol)}${amount.toFixed(2)}`;
}

function itemRows(items: ReceiptItem[], currencySymbol: string): string {
  return items
    .map(
      (item, i) => `
      <tr style="border-bottom: 1px solid #e5e7eb;${i % 2 === 1 ? ' background-color: #f9fafb;' : ''}">
        <td style="padding: 12px; font-size: 14px;">${escapeHtml(item.name)}${item.staff ? `<br/><span style="color: #6b7280; font-size: 12px;">by ${escapeHtml(item.staff)}</span>` : ''}</td>
        <td style="padding: 12px; text-align: center; font-size: 14px;">${item.quantity}</td>
        <td style="padding: 12px; text-align: right; font-size: 14px;">${formatCurrency(currencySymbol, item.price * item.quantity)}</td>
      </tr>`
    )
    .join("");
}

export function receiptEmailHtml(data: ReceiptEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background-color: #8b5cf6; padding: 32px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${escapeHtml(data.salonName)}</h1>
            <p style="color: #e9d5ff; margin: 8px 0 0; font-size: 14px;">Your Receipt</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding: 32px 32px 16px;">
            <p style="margin: 0; font-size: 16px; color: #111827;">Hi ${escapeHtml(data.clientName)},</p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #6b7280;">Thank you for your visit! Here&rsquo;s your receipt.</p>
          </td>
        </tr>

        <!-- Invoice Info -->
        <tr>
          <td style="padding: 0 32px 16px;">
            <table width="100%" style="background-color: #f9fafb; border-radius: 6px; padding: 16px;">
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Invoice #</td>
                <td style="font-size: 13px; font-weight: bold; text-align: right;">${data.invoiceNumber}</td>
              </tr>
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Date</td>
                <td style="font-size: 13px; text-align: right;">${data.date}</td>
              </tr>
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Payment</td>
                <td style="font-size: 13px; text-align: right;">${data.paymentMethods.join(", ")}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Items -->
        <tr>
          <td style="padding: 0 32px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
              <tr style="background-color: #8b5cf6;">
                <th style="padding: 10px 12px; text-align: left; color: #ffffff; font-size: 12px; font-weight: 600;">Item</th>
                <th style="padding: 10px 12px; text-align: center; color: #ffffff; font-size: 12px; font-weight: 600;">Qty</th>
                <th style="padding: 10px 12px; text-align: right; color: #ffffff; font-size: 12px; font-weight: 600;">Amount</th>
              </tr>
              ${itemRows(data.items, data.currencySymbol)}
            </table>
          </td>
        </tr>

        <!-- Totals -->
        <tr>
          <td style="padding: 0 32px 32px;">
            <table width="100%" style="border-top: 2px solid #e5e7eb; padding-top: 12px;">
              <tr>
                <td style="font-size: 14px; color: #6b7280; padding: 4px 0;">Subtotal</td>
                <td style="font-size: 14px; text-align: right; padding: 4px 0;">${formatCurrency(data.currencySymbol, data.subtotal)}</td>
              </tr>
              ${data.discount > 0 ? `
              <tr>
                <td style="font-size: 14px; color: #16a34a; padding: 4px 0;">Discount</td>
                <td style="font-size: 14px; color: #16a34a; text-align: right; padding: 4px 0;">-${formatCurrency(data.currencySymbol, data.discount)}</td>
              </tr>` : ''}
              ${data.tax > 0 ? `
              <tr>
                <td style="font-size: 14px; color: #6b7280; padding: 4px 0;">Tax</td>
                <td style="font-size: 14px; text-align: right; padding: 4px 0;">${formatCurrency(data.currencySymbol, data.tax)}</td>
              </tr>` : ''}
              <tr>
                <td style="font-size: 18px; font-weight: bold; color: #8b5cf6; padding: 12px 0 0; border-top: 1px solid #e5e7eb;">Total</td>
                <td style="font-size: 18px; font-weight: bold; color: #8b5cf6; text-align: right; padding: 12px 0 0; border-top: 1px solid #e5e7eb;">${formatCurrency(data.currencySymbol, data.total)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">Thank you for choosing ${escapeHtml(data.salonName)}!</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">We look forward to seeing you again.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function invoiceEmailHtml(data: InvoiceEmailData): string {
  const statusColors: Record<string, string> = {
    PAID: "#16a34a",
    OVERDUE: "#dc2626",
    PENDING: "#d97706",
    CANCELLED: "#6b7280",
    REFUNDED: "#2563eb",
  };
  const statusColor = statusColors[data.status] ?? "#d97706";
  const statusLabel = data.status.charAt(0) + data.status.slice(1).toLowerCase();

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background-color: #8b5cf6; padding: 32px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${escapeHtml(data.salonName)}</h1>
            <p style="color: #e9d5ff; margin: 8px 0 0; font-size: 14px;">Invoice ${escapeHtml(data.invoiceNumber)}</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding: 32px 32px 16px;">
            <p style="margin: 0; font-size: 16px; color: #111827;">Hi ${escapeHtml(data.clientName)},</p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #6b7280;">Please find your invoice details below.</p>
          </td>
        </tr>

        <!-- Invoice Info -->
        <tr>
          <td style="padding: 0 32px 16px;">
            <table width="100%" style="background-color: #f9fafb; border-radius: 6px; padding: 16px;">
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Invoice #</td>
                <td style="font-size: 13px; font-weight: bold; text-align: right;">${data.invoiceNumber}</td>
              </tr>
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Date</td>
                <td style="font-size: 13px; text-align: right;">${data.date}</td>
              </tr>
              <tr>
                <td style="font-size: 13px; color: #6b7280;">Status</td>
                <td style="font-size: 13px; font-weight: bold; text-align: right; color: ${statusColor};">${statusLabel}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Salon Info -->
        ${data.salonAddress || data.salonPhone || data.salonEmail ? `
        <tr>
          <td style="padding: 0 32px 16px;">
            <table width="100%" style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;">
              <tr><td style="font-size: 12px; font-weight: 600; color: #374151; padding-bottom: 4px;">From:</td></tr>
              <tr><td style="font-size: 12px; color: #6b7280;">${escapeHtml(data.salonName)}</td></tr>
              ${data.salonAddress ? `<tr><td style="font-size: 12px; color: #6b7280;">${escapeHtml(data.salonAddress)}</td></tr>` : ''}
              ${data.salonPhone ? `<tr><td style="font-size: 12px; color: #6b7280;">${escapeHtml(data.salonPhone)}</td></tr>` : ''}
              ${data.salonEmail ? `<tr><td style="font-size: 12px; color: #6b7280;">${escapeHtml(data.salonEmail)}</td></tr>` : ''}
            </table>
          </td>
        </tr>` : ''}

        <!-- Items -->
        <tr>
          <td style="padding: 0 32px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
              <tr style="background-color: #8b5cf6;">
                <th style="padding: 10px 12px; text-align: left; color: #ffffff; font-size: 12px; font-weight: 600;">Item</th>
                <th style="padding: 10px 12px; text-align: center; color: #ffffff; font-size: 12px; font-weight: 600;">Qty</th>
                <th style="padding: 10px 12px; text-align: right; color: #ffffff; font-size: 12px; font-weight: 600;">Amount</th>
              </tr>
              ${itemRows(data.items, data.currencySymbol)}
            </table>
          </td>
        </tr>

        <!-- Totals -->
        <tr>
          <td style="padding: 0 32px 32px;">
            <table width="100%" style="border-top: 2px solid #e5e7eb; padding-top: 12px;">
              <tr>
                <td style="font-size: 14px; color: #6b7280; padding: 4px 0;">Subtotal</td>
                <td style="font-size: 14px; text-align: right; padding: 4px 0;">${formatCurrency(data.currencySymbol, data.subtotal)}</td>
              </tr>
              ${data.discount > 0 ? `
              <tr>
                <td style="font-size: 14px; color: #16a34a; padding: 4px 0;">Discount</td>
                <td style="font-size: 14px; color: #16a34a; text-align: right; padding: 4px 0;">-${formatCurrency(data.currencySymbol, data.discount)}</td>
              </tr>` : ''}
              ${data.tax > 0 ? `
              <tr>
                <td style="font-size: 14px; color: #6b7280; padding: 4px 0;">Tax</td>
                <td style="font-size: 14px; text-align: right; padding: 4px 0;">${formatCurrency(data.currencySymbol, data.tax)}</td>
              </tr>` : ''}
              <tr>
                <td style="font-size: 18px; font-weight: bold; color: #8b5cf6; padding: 12px 0 0; border-top: 1px solid #e5e7eb;">Total</td>
                <td style="font-size: 18px; font-weight: bold; color: #8b5cf6; text-align: right; padding: 12px 0 0; border-top: 1px solid #e5e7eb;">${formatCurrency(data.currencySymbol, data.total)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">Thank you for your business!</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #9ca3af;">${escapeHtml(data.salonName)}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
