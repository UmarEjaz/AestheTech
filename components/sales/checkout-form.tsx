"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  User,
  Scissors,
  CreditCard,
  Banknote,
  Wallet,
  Star,
  Loader2,
  Receipt,
  Percent,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { quickSale } from "@/lib/actions/sale";
import { PaymentMethod } from "@prisma/client";

interface CartItem {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  price: number;
  quantity: number;
  points: number;
}

interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  loyaltyPoints?: {
    balance: number;
    tier: string;
  } | null;
}

interface Service {
  id: string;
  name: string;
  price: number;
  duration: number;
  category: string | null;
  points: number;
}

interface Staff {
  id: string;
  firstName: string;
  lastName: string;
}

interface CheckoutFormProps {
  clients: Client[];
  services: Service[];
  staff: Staff[];
  currencySymbol: string;
  taxRate: number;
}

export function CheckoutForm({
  clients,
  services,
  staff,
  currencySymbol,
  taxRate,
}: CheckoutFormProps) {
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">("fixed");
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<string>(staff[0]?.id || "");

  // Filter clients based on search
  const filteredClients = clients.filter((client) => {
    const search = clientSearch.toLowerCase();
    return (
      client.firstName.toLowerCase().includes(search) ||
      client.lastName.toLowerCase().includes(search) ||
      client.phone.includes(search)
    );
  });

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = discountType === "percentage" ? (subtotal * discount) / 100 : discount;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const pointsValue = redeemPoints / 100; // 100 points = $1
  const afterPoints = Math.max(0, afterDiscount - pointsValue);
  const taxAmount = (afterPoints * taxRate) / 100;
  const total = afterPoints + taxAmount;

  // Calculate points to be earned
  const pointsToEarn = cart.reduce((sum, item) => sum + item.points * item.quantity, 0);

  const addToCart = (service: Service) => {
    const existingItem = cart.find(
      (item) => item.serviceId === service.id && item.staffId === selectedStaff
    );

    if (existingItem) {
      setCart(
        cart.map((item) =>
          item.id === existingItem.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      const staffMember = staff.find((s) => s.id === selectedStaff);
      setCart([
        ...cart,
        {
          id: `${service.id}-${selectedStaff}-${Date.now()}`,
          serviceId: service.id,
          serviceName: service.name,
          staffId: selectedStaff,
          staffName: staffMember ? `${staffMember.firstName} ${staffMember.lastName}` : "",
          price: Number(service.price),
          quantity: 1,
          points: service.points,
        },
      ]);
    }
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(
      cart
        .map((item) =>
          item.id === itemId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeItem = (itemId: string) => {
    setCart(cart.filter((item) => item.id !== itemId));
  };

  const handlePayment = async (method: PaymentMethod) => {
    if (!selectedClient) {
      toast.error("Please select a client");
      return;
    }

    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await quickSale({
        clientId: selectedClient.id,
        items: cart.map((item) => ({
          serviceId: item.serviceId,
          staffId: item.staffId,
          quantity: item.quantity,
          price: item.price,
        })),
        discount,
        discountType,
        payments: [{ method, amount: total }],
        redeemPoints,
      });

      if (result.success) {
        toast.success(`Sale completed! Invoice: ${result.data.invoiceNumber}`);
        if (result.data.pointsEarned > 0) {
          toast.info(`Client earned ${result.data.pointsEarned} loyalty points!`);
        }
        setIsPaymentOpen(false);
        router.push(`/dashboard/sales`);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to process sale");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
  };

  // Group services by category
  const servicesByCategory = services.reduce((acc, service) => {
    const category = service.category || "Other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Service Selection */}
      <div className="lg:col-span-2 space-y-6">
        {/* Client Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Select Client
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedClient ? (
              <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-purple-100 text-purple-600">
                      {getInitials(selectedClient.firstName, selectedClient.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {selectedClient.firstName} {selectedClient.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">{selectedClient.phone}</p>
                  </div>
                  {selectedClient.loyaltyPoints && (
                    <Badge variant="secondary" className="ml-2">
                      <Star className="h-3 w-3 mr-1" />
                      {selectedClient.loyaltyPoints.balance} pts
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search client by name or phone..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {clientSearch && (
                  <div className="max-h-48 overflow-y-auto border rounded-lg">
                    {filteredClients.length === 0 ? (
                      <p className="p-3 text-center text-muted-foreground">No clients found</p>
                    ) : (
                      filteredClients.slice(0, 5).map((client) => (
                        <button
                          key={client.id}
                          onClick={() => {
                            setSelectedClient(client);
                            setClientSearch("");
                            setRedeemPoints(0);
                          }}
                          className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {getInitials(client.firstName, client.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              {client.firstName} {client.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">{client.phone}</p>
                          </div>
                          {client.loyaltyPoints && (
                            <Badge variant="outline" className="text-xs">
                              {client.loyaltyPoints.balance} pts
                            </Badge>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Staff Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Scissors className="h-5 w-5" />
              Staff Member
            </CardTitle>
            <CardDescription>Select the staff member performing the services</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger>
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Services */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Services</CardTitle>
            <CardDescription>Click a service to add it to the cart</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(servicesByCategory).map(([category, categoryServices]) => (
                <div key={category}>
                  <h4 className="font-medium text-sm text-muted-foreground mb-2">{category}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {categoryServices.map((service) => (
                      <button
                        key={service.id}
                        onClick={() => addToCart(service)}
                        disabled={!selectedStaff}
                        className="p-3 border rounded-lg hover:bg-muted hover:border-purple-300 text-left transition-colors disabled:opacity-50"
                      >
                        <p className="font-medium text-sm truncate">{service.name}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-sm text-purple-600 font-semibold">
                            {currencySymbol}{Number(service.price).toFixed(2)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {service.duration}min
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: Cart */}
      <div className="space-y-4">
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Cart
            </CardTitle>
            <CardDescription>
              {cart.length} {cart.length === 1 ? "item" : "items"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cart.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Cart is empty. Add services to begin.
              </p>
            ) : (
              <>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 p-2 bg-muted/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.serviceName}</p>
                        <p className="text-xs text-muted-foreground truncate">by {item.staffName}</p>
                        <p className="text-sm font-semibold text-purple-600">
                          {currencySymbol}{(item.price * item.quantity).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.id, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Discount */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Percent className="h-3 w-3" />
                    Discount
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      value={discount}
                      onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                      className="flex-1"
                    />
                    <Select
                      value={discountType}
                      onValueChange={(v) => setDiscountType(v as "fixed" | "percentage")}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">{currencySymbol}</SelectItem>
                        <SelectItem value="percentage">%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Loyalty Points Redemption */}
                {selectedClient?.loyaltyPoints && selectedClient.loyaltyPoints.balance > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      Redeem Points (100 pts = {currencySymbol}1)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max={selectedClient.loyaltyPoints.balance}
                        value={redeemPoints}
                        onChange={(e) =>
                          setRedeemPoints(
                            Math.min(
                              parseInt(e.target.value) || 0,
                              selectedClient.loyaltyPoints?.balance || 0
                            )
                          )
                        }
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground">
                        / {selectedClient.loyaltyPoints.balance}
                      </span>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Totals */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{currencySymbol}{subtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount</span>
                      <span>-{currencySymbol}{discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {redeemPoints > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Points Redeemed ({redeemPoints})</span>
                      <span>-{currencySymbol}{pointsValue.toFixed(2)}</span>
                    </div>
                  )}
                  {taxRate > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                      <span>{currencySymbol}{taxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-purple-600">{currencySymbol}{total.toFixed(2)}</span>
                  </div>
                  {pointsToEarn > 0 && (
                    <div className="flex justify-between text-xs text-amber-600">
                      <span>Points to earn</span>
                      <span>+{pointsToEarn} pts</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              size="lg"
              disabled={!selectedClient || cart.length === 0}
              onClick={() => setIsPaymentOpen(true)}
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Proceed to Payment
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Payment Modal */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Payment Method</DialogTitle>
            <DialogDescription>
              Total: {currencySymbol}{total.toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => handlePayment(PaymentMethod.CASH)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <>
                  <Banknote className="h-8 w-8" />
                  <span>Cash</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => handlePayment(PaymentMethod.CARD)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <>
                  <CreditCard className="h-8 w-8" />
                  <span>Card</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => handlePayment(PaymentMethod.DIGITAL_WALLET)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <>
                  <Wallet className="h-8 w-8" />
                  <span>Digital Wallet</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => handlePayment(PaymentMethod.OTHER)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <>
                  <Receipt className="h-8 w-8" />
                  <span>Other</span>
                </>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsPaymentOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
