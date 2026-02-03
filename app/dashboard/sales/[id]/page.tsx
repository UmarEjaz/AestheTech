import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { format } from "date-fns";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Receipt,
  Clock,
  RotateCcw,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSale } from "@/lib/actions/sale";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { InvoicePDFData } from "@/components/invoices/invoice-pdf";
import { RefundDialog } from "@/components/sales/refund-dialog";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;

  if (!hasPermission(userRole, "sales:view")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [saleResult, settingsResult] = await Promise.all([
    getSale(id),
    getSettings(),
  ]);

  if (!saleResult.success) {
    notFound();
  }

  const sale = saleResult.data;
  const settings = settingsResult.success ? settingsResult.data : {
    currencySymbol: "$",
    salonName: "AestheTech Salon",
    salonAddress: null,
    salonPhone: null,
    salonEmail: null,
    salonLogo: null,
    taxRate: 0,
  };

  const getInitials = (firstName: string, lastName: string | null) => {
    return `${firstName[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  // Prepare invoice data for PDF
  const invoiceData: InvoicePDFData | null = sale.invoice
    ? {
        invoiceNumber: sale.invoice.invoiceNumber,
        status: sale.invoice.status,
        createdAt: sale.createdAt.toISOString(),
        salonName: settings.salonName,
        salonAddress: settings.salonAddress,
        salonPhone: settings.salonPhone,
        salonEmail: settings.salonEmail,
        salonLogo: settings.salonLogo,
        currencySymbol: settings.currencySymbol,
        taxRate: settings.taxRate,
        client: {
          firstName: sale.client.firstName,
          lastName: sale.client.lastName,
          email: sale.client.email,
          phone: sale.client.phone,
          isWalkIn: sale.client.isWalkIn,
        },
        items: sale.items.map((item) => ({
          id: item.id,
          service: { name: item.service.name },
          staff: {
            firstName: item.staff.firstName,
            lastName: item.staff.lastName,
          },
          price: Number(item.price),
          quantity: item.quantity,
        })),
        subtotal: Number(sale.totalAmount),
        discount: Number(sale.discount),
        tax: Number(sale.invoice.tax),
        total: Number(sale.invoice.total),
        loyaltyPointsEarned: 0,
        loyaltyPointsRedeemed: 0,
      }
    : null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PAID":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
      case "PENDING":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</Badge>;
      case "OVERDUE":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Overdue</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary">Cancelled</Badge>;
      case "REFUNDED":
        return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">Refunded</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  // Calculate refund information
  const canRefund = hasPermission(userRole, "invoices:refund");
  const invoiceRefunds = sale.invoice?.refunds || [];
  const totalRefunded = invoiceRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const maxRefundable = sale.invoice ? Number(sale.invoice.total) - totalRefunded : 0;
  const canIssueRefund = canRefund && sale.invoice?.status === "PAID" && maxRefundable > 0;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/sales">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Sale Details</h1>
              <p className="text-muted-foreground">
                {sale.invoice ? `Invoice ${sale.invoice.invoiceNumber}` : "Draft Sale"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {canIssueRefund && sale.invoice && (
              <RefundDialog
                invoiceId={sale.invoice.id}
                invoiceNumber={sale.invoice.invoiceNumber}
                maxRefundable={maxRefundable}
                currencySymbol={settings.currencySymbol}
              />
            )}
            {sale.invoice && invoiceData && (
              <InvoiceDownloadButton invoiceData={invoiceData} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Services */}
            <Card>
              <CardHeader>
                <CardTitle>Services</CardTitle>
                <CardDescription>{sale.items.length} items</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sale.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.service.name}</TableCell>
                        <TableCell>
                          {item.staff.firstName} {item.staff.lastName}
                        </TableCell>
                        <TableCell className="text-right">
                          {settings.currencySymbol}{Number(item.price).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell className="text-right font-medium">
                          {settings.currencySymbol}{(Number(item.price) * item.quantity).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Invoice Details (if exists) */}
            {sale.invoice && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5" />
                    Invoice
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Invoice Number</span>
                    <span className="font-mono font-medium">{sale.invoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Status</span>
                    {getStatusBadge(sale.invoice.status)}
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-lg font-bold">
                    <span>Total</span>
                    <span className="text-purple-600">
                      {settings.currencySymbol}{Number(sale.invoice.total).toFixed(2)}
                    </span>
                  </div>
                  {totalRefunded > 0 && (
                    <>
                      <Separator />
                      <div className="flex justify-between items-center text-red-600">
                        <span>Total Refunded</span>
                        <span>-{settings.currencySymbol}{totalRefunded.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center font-medium">
                        <span>Net Amount</span>
                        <span>{settings.currencySymbol}{(Number(sale.invoice.total) - totalRefunded).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Refund History (if exists) */}
            {invoiceRefunds.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="h-5 w-5" />
                    Refund History
                  </CardTitle>
                  <CardDescription>{invoiceRefunds.length} refund(s) issued</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Points Reversed</TableHead>
                        <TableHead>Processed By</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceRefunds.map((refund) => (
                        <TableRow key={refund.id}>
                          <TableCell>
                            {format(new Date(refund.createdAt), "MMM d, yyyy h:mm a")}
                          </TableCell>
                          <TableCell className="text-red-600 font-medium">
                            -{settings.currencySymbol}{Number(refund.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {refund.pointsReversed > 0 ? (
                              <span className="text-amber-600">-{refund.pointsReversed} pts</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {refund.refundedBy.firstName} {refund.refundedBy.lastName}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {refund.reason || <span className="text-muted-foreground">No reason provided</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Client Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Client
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-purple-100 text-purple-600">
                      {getInitials(sale.client.firstName, sale.client.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {sale.client.firstName} {sale.client.lastName}
                      </p>
                      {sale.client.isWalkIn && (
                        <Badge variant="secondary" className="text-xs">
                          Walk-in
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {sale.client.phone || <span className="italic">No phone</span>}
                    </p>
                    {sale.client.email && (
                      <p className="text-sm text-muted-foreground">{sale.client.email}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <Link href={`/dashboard/clients/${sale.client.id}`}>
                      View Profile
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Sale Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{settings.currencySymbol}{Number(sale.totalAmount).toFixed(2)}</span>
                </div>
                {Number(sale.discount) > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{settings.currencySymbol}{Number(sale.discount).toFixed(2)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Final Amount</span>
                  <span className="text-purple-600">
                    {settings.currencySymbol}{Number(sale.finalAmount).toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Sale Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Sale Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{format(new Date(sale.createdAt), "MMM d, yyyy")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span>{format(new Date(sale.createdAt), "h:mm a")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Staff</span>
                  <span>{sale.staff.firstName} {sale.staff.lastName}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
