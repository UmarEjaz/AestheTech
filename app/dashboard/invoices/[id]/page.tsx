import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInvoice } from "@/lib/actions/invoice";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";
import { formatCurrency } from "@/lib/utils/currency";
import { formatInTz } from "@/lib/utils/timezone";
import { amountDue, formatInvoiceStatus } from "@/lib/utils/invoice-status";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoicePDFData } from "@/components/invoices/invoice-pdf";

interface PageProps {
  params: Promise<{ id: string }>;
}

function statusVariant(status: string) {
  switch (status) {
    case "PAID":
      return "success" as const;
    case "PENDING":
    case "PARTIALLY_PAID":
      return "warning" as const;
    case "OVERDUE":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }

  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("invoices");
  const permUserId = actor.userId;
  if (!(await hasPermission(userRoleId, "invoices:view", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["invoices:view"]);
  }

  const { id } = await params;
  const [invoiceResult, settingsResult] = await Promise.all([getInvoice(id), getSettings()]);

  if (!invoiceResult.success) {
    notFound();
  }
  const invoice = invoiceResult.data;
  const settings = settingsResult.success
    ? settingsResult.data
    : {
        currencyCode: "USD",
        timezone: "UTC",
        salonName: "Salon",
        salonAddress: null,
        salonPhone: null,
        salonEmail: null,
        salonLogo: null,
        taxRate: 0,
      };
  const currency = settings.currencyCode;
  const tz = settings.timezone;

  const [canUpdate, canDelete, canRefund] = await Promise.all([
    hasPermission(userRoleId, "invoices:update", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "invoices:delete", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "invoices:refund", isSuperAdmin, salonId, permUserId),
  ]);

  const totalRefunded = invoice.refunds.reduce((s, r) => s + Number(r.amount), 0);
  const maxRefundable = Number(invoice.total) - totalRefunded;
  const canIssueRefund = canRefund && invoice.status === "PAID" && maxRefundable > 0;
  const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);

  const pdfData: InvoicePDFData = {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
    salonName: settings.salonName,
    salonAddress: settings.salonAddress,
    salonPhone: settings.salonPhone,
    salonEmail: settings.salonEmail,
    salonLogo: settings.salonLogo,
    currencyCode: currency,
    taxRate: settings.taxRate,
    timezone: tz,
    client: {
      firstName: invoice.client.firstName,
      lastName: invoice.client.lastName,
      email: invoice.client.email,
      phone: invoice.client.phone,
      isWalkIn: invoice.client.isWalkIn,
    },
    items: invoice.sale.items.map((item) => ({
      id: item.id,
      service: item.service ? { name: item.service.name } : null,
      staff: item.staff ? { firstName: item.staff.firstName, lastName: item.staff.lastName } : null,
      product: item.product ? { name: item.product.name } : null,
      price: Number(item.price),
      quantity: item.quantity,
      discount: Number(item.discount),
      note: item.note ?? null,
    })),
    subtotal: Number(invoice.sale.totalAmount),
    discount: Number(invoice.sale.discount),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    loyaltyPointsEarned: 0,
    loyaltyPointsRedeemed: 0,
  };

  return (
    <>
      <div className="space-y-6">
        {/* Back nav */}
        <Button variant="ghost" size="sm" asChild className="mb-1">
          <Link href="/dashboard/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Link>
        </Button>

        {/* Header — title on the left, actions top-right (Download + a "⋯" menu
            holding Refund/Update Status/Cancel; Add Payment shows as a button when
            there's a balance — all status-aware). */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold break-all">Invoice {invoice.invoiceNumber}</h1>
              <Badge variant={statusVariant(invoice.status)}>{formatInvoiceStatus(invoice.status)}</Badge>
            </div>
            <p className="text-muted-foreground">
              Issued {formatInTz(invoice.createdAt, "dd MMM yyyy, h:mm a", tz)}
              {invoice.dueDate && (invoice.status === "PENDING" || invoice.status === "PARTIALLY_PAID" || invoice.status === "OVERDUE") && (
                <> · Due {formatInTz(invoice.dueDate, "dd MMM yyyy", tz)}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            <InvoiceDownloadButton invoiceData={pdfData} />
            <InvoiceActions
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              status={invoice.status}
              canUpdate={canUpdate}
              canDelete={canDelete}
              canRefund={canIssueRefund}
              maxRefundable={maxRefundable}
              currencyCode={currency}
              amountDue={amountDue(Number(invoice.total), invoice.payments)}
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: line items + totals */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Items</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="hidden sm:table-cell">Staff</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.sale.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.service?.name ?? item.product?.name ?? "Item"}
                          {Number(item.discount) > 0 && (
                            <div className="text-xs font-normal text-green-600">
                              −{formatCurrency(Number(item.discount), currency)} discount
                            </div>
                          )}
                          {item.note && (
                            <div className="text-xs font-normal text-muted-foreground">📝 {item.note}</div>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {item.staff ? `${item.staff.firstName} ${item.staff.lastName}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(item.price), currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator className="my-4" />

                <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(Number(invoice.sale.totalAmount), currency)}</span>
                  </div>
                  {Number(invoice.sale.discount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Discount</span>
                      <span>-{formatCurrency(Number(invoice.sale.discount), currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{formatCurrency(Number(invoice.tax), currency)}</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between text-base font-bold">
                    <span>Total</span>
                    <span>{formatCurrency(Number(invoice.total), currency)}</span>
                  </div>
                  {totalPaid > 0 && totalPaid < Number(invoice.total) && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Paid</span>
                      <span>{formatCurrency(totalPaid, currency)}</span>
                    </div>
                  )}
                  {(invoice.status === "PENDING" || invoice.status === "PARTIALLY_PAID" || invoice.status === "OVERDUE") && (
                    <div className="flex justify-between font-semibold text-destructive">
                      <span>Amount due</span>
                      <span>{formatCurrency(amountDue(Number(invoice.total), invoice.payments), currency)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Payments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {invoice.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payments recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {invoice.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {p.method.replace("_", " ")} · {formatInTz(p.paidAt, "dd MMM yyyy", tz)}
                        </span>
                        <span className="font-medium">{formatCurrency(Number(p.amount), currency)}</span>
                      </div>
                    ))}
                    <Separator className="my-1" />
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>Total paid</span>
                      <span>{formatCurrency(totalPaid, currency)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Refunds */}
            {invoice.refunds.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Refunds</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {invoice.refunds.map((r) => (
                      <div key={r.id} className="flex items-start justify-between text-sm">
                        <div>
                          <p className="text-muted-foreground">
                            {formatInTz(r.createdAt, "dd MMM yyyy", tz)}
                            {r.refundedBy && ` · by ${r.refundedBy.firstName} ${r.refundedBy.lastName}`}
                          </p>
                          {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                        </div>
                        <span className="font-medium text-destructive">
                          -{formatCurrency(Number(r.amount), currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: client */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">
                  {invoice.client.firstName} {invoice.client.lastName ?? ""}
                  {invoice.client.isWalkIn && (
                    <Badge variant="secondary" className="ml-2 text-xs">Walk-in</Badge>
                  )}
                </p>
                {invoice.client.phone && <p className="text-muted-foreground">{invoice.client.phone}</p>}
                {invoice.client.email && <p className="text-muted-foreground">{invoice.client.email}</p>}
                <Separator className="my-2" />
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={`/dashboard/sales/${invoice.saleId}`}>View original sale</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
