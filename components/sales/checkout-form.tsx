"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  User,
  UserPlus,
  Users,
  Scissors,
  CreditCard,
  Star,
  Loader2,
  Receipt,
  Percent,
} from "lucide-react";
import { toast } from "sonner";
import { createWalkInClient } from "@/lib/actions/client";

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
import { PaymentMethodIcon, PAYMENT_METHOD_LABELS, SELECTABLE_PAYMENT_METHODS } from "@/lib/constants/payment-methods";

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
  lastName: string | null;
  phone: string | null;
  email: string | null;
  isWalkIn?: boolean;
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

interface SplitPayment {
  id: number;
  method: PaymentMethod;
  amount: number;
}

interface CheckoutFormProps {
  clients: Client[];
  services: Service[];
  staff: Staff[];
  currencySymbol: string;
  taxRate: number;
  pointsPerDollar: number;
  loyaltyProgramEnabled?: boolean;
}

export function CheckoutForm({
  clients,
  services,
  staff,
  currencySymbol,
  taxRate,
  pointsPerDollar,
  loyaltyProgramEnabled = true,
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
  const [submittingMethod, setSubmittingMethod] = useState<PaymentMethod | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string>(staff[0]?.id || "");

  // Split payment state
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [splitAmount, setSplitAmount] = useState("");
  const [splitIdCounter, setSplitIdCounter] = useState(0);

  // Walk-in client state
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  // Filter clients based on search
  const filteredClients = clients.filter((client) => {
    const search = clientSearch.toLowerCase();
    return (
      client.firstName.toLowerCase().includes(search) ||
      (client.lastName?.toLowerCase().includes(search) ?? false) ||
      (client.phone?.includes(search) ?? false)
    );
  });

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = discountType === "percentage" ? (subtotal * discount) / 100 : discount;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const pointsValue = redeemPoints / pointsPerDollar;
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

  // Reset split entries if total changes while in split mode (safety net)
  const prevTotalRef = useRef(total);
  useEffect(() => {
    if (isSplitMode && prevTotalRef.current !== total) {
      setSplitAmount(total.toFixed(2));
      if (splitPayments.length > 0) {
        setSplitPayments([]);
        toast.info("Cart total changed — split payments have been reset.");
      }
    }
    prevTotalRef.current = total;
  }, [total, isSplitMode, splitPayments.length]);

  // Split payment helpers
  const splitTotal = splitPayments.reduce((sum, p) => sum + p.amount, 0);
  const splitRemaining = Math.round((total - splitTotal) * 100) / 100;
  const isSplitComplete = Math.abs(splitRemaining) < 0.01;

  const addSplitPayment = () => {
    const parsed = parseFloat(splitAmount);
    if (!parsed || parsed <= 0) {
      toast.error(`Enter a valid amount greater than ${currencySymbol}0`);
      return;
    }
    // Round to cents and clamp to remaining balance
    const amount = Math.round(Math.min(parsed, splitRemaining) * 100) / 100;
    if (amount <= 0) {
      toast.error(`Remaining balance is ${currencySymbol}${splitRemaining.toFixed(2)} — no more to split`);
      return;
    }
    const nextId = splitIdCounter + 1;
    setSplitIdCounter(nextId);
    setSplitPayments([...splitPayments, { id: nextId, method: splitMethod, amount }]);
    // Auto-fill next amount with remaining, or clear
    const newRemaining = Math.round((splitRemaining - amount) * 100) / 100;
    setSplitAmount(newRemaining > 0 ? newRemaining.toFixed(2) : "");
  };

  const removeSplitPayment = (id: number) => {
    setSplitPayments(splitPayments.filter((p) => p.id !== id));
  };

  const submitPayment = async (payments: { method: PaymentMethod; amount: number }[]) => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    setIsSubmitting(true);

    try {
      let clientId: string;

      // If walk-in, create the walk-in client first
      if (isWalkIn) {
        if (!walkInName.trim()) {
          toast.error("Please enter the walk-in client's name");
          setIsSubmitting(false);
          return;
        }

        const walkInResult = await createWalkInClient({
          firstName: walkInName.trim(),
          phone: walkInPhone.trim() || undefined,
        });

        if (!walkInResult.success) {
          toast.error(walkInResult.error);
          setIsSubmitting(false);
          return;
        }

        clientId = walkInResult.data.id;
        toast.success(`Walk-in client "${walkInResult.data.firstName}" created`);
      } else {
        if (!selectedClient) {
          toast.error("Please select a client");
          setIsSubmitting(false);
          return;
        }
        clientId = selectedClient.id;
      }

      const result = await quickSale({
        clientId,
        items: cart.map((item) => ({
          serviceId: item.serviceId,
          staffId: item.staffId,
          quantity: item.quantity,
          price: item.price,
        })),
        discount,
        discountType,
        payments,
        redeemPoints: isWalkIn ? 0 : redeemPoints,
      });

      if (result.success) {
        toast.success(`Sale completed! Invoice: ${result.data.invoiceNumber}`);
        if (result.data.pointsEarned > 0) {
          toast.info(`Client earned ${result.data.pointsEarned} loyalty points!`);
        }
        if (result.data.birthdayBonus > 0) {
          toast.success(`Happy Birthday! ${result.data.birthdayBonus} bonus points awarded!`);
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
      setSubmittingMethod(null);
    }
  };

  const handleSinglePayment = (method: PaymentMethod) => {
    setSubmittingMethod(method);
    submitPayment([{ method, amount: total }]);
  };

  const handleSplitComplete = () => {
    if (!isSplitComplete) return;
    submitPayment(splitPayments.map(({ method, amount }) => ({ method, amount })));
  };

  const getInitials = (firstName: string, lastName: string | null) => {
    return `${firstName[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
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
          <CardContent className="space-y-4">
            {/* Walk-in Toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!isWalkIn ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsWalkIn(false);
                  setWalkInName("");
                  setWalkInPhone("");
                }}
                className="flex-1"
              >
                <Users className="h-4 w-4 mr-2" />
                Existing Client
              </Button>
              <Button
                type="button"
                variant={isWalkIn ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsWalkIn(true);
                  setSelectedClient(null);
                  setClientSearch("");
                  setRedeemPoints(0);
                }}
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Walk-in Client
              </Button>
            </div>

            {isWalkIn ? (
              /* Walk-in Client Form */
              <div className="space-y-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="space-y-2">
                  <Label htmlFor="walkInName">Client Name *</Label>
                  <Input
                    id="walkInName"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="Enter client's name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="walkInPhone">Phone (Optional)</Label>
                  <Input
                    id="walkInPhone"
                    value={walkInPhone}
                    onChange={(e) => setWalkInPhone(e.target.value)}
                    placeholder="Enter phone number"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  A new walk-in client will be created when completing the sale.
                </p>
              </div>
            ) : selectedClient ? (
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
                    <p className="text-sm text-muted-foreground">
                      {selectedClient.phone || <span className="italic">No phone</span>}
                    </p>
                  </div>
                  {loyaltyProgramEnabled && selectedClient.loyaltyPoints && (
                    <div className="flex items-center gap-1 ml-2">
                      <Badge variant="secondary">
                        <Star className="h-3 w-3 mr-1" />
                        {selectedClient.loyaltyPoints.balance} pts
                      </Badge>
                      {selectedClient.loyaltyPoints.tier !== "SILVER" && (
                        <Badge variant="outline" className="text-xs">
                          {selectedClient.loyaltyPoints.tier}
                        </Badge>
                      )}
                    </div>
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
                            <div className="flex items-center gap-1">
                              <p className="font-medium text-sm">
                                {client.firstName} {client.lastName}
                              </p>
                              {client.isWalkIn && (
                                <Badge variant="secondary" className="text-xs">
                                  Walk-in
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {client.phone || <span className="italic">No phone</span>}
                            </p>
                          </div>
                          {loyaltyProgramEnabled && client.loyaltyPoints && (
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
                {loyaltyProgramEnabled && selectedClient?.loyaltyPoints && selectedClient.loyaltyPoints.balance > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      Redeem Points ({pointsPerDollar} pts = {currencySymbol}1)
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
                  {loyaltyProgramEnabled && redeemPoints > 0 && (
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
                  {loyaltyProgramEnabled && pointsToEarn > 0 && (
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
              disabled={(!selectedClient && !isWalkIn) || cart.length === 0}
              onClick={() => setIsPaymentOpen(true)}
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Proceed to Payment
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Payment Modal */}
      <Dialog
        open={isPaymentOpen}
        onOpenChange={(open) => {
          setIsPaymentOpen(open);
          if (!open) {
            setIsSplitMode(false);
            setSplitPayments([]);
            setSplitAmount("");
            setSplitMethod(PaymentMethod.CASH);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isSplitMode ? "Split Payment" : "Select Payment Method"}
            </DialogTitle>
            <DialogDescription>
              Total: {currencySymbol}{total.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          {!isSplitMode ? (
            <>
              <div className="grid grid-cols-2 gap-3 py-4">
                {SELECTABLE_PAYMENT_METHODS.map((method) => (
                  <Button
                    key={method}
                    variant="outline"
                    className="h-24 flex-col gap-2"
                    onClick={() => handleSinglePayment(method)}
                    disabled={isSubmitting}
                    aria-label={`Pay with ${PAYMENT_METHOD_LABELS[method]}`}
                  >
                    {isSubmitting && submittingMethod === method ? (
                      <Loader2 className="h-8 w-8 animate-spin" />
                    ) : (
                      <>
                        <PaymentMethodIcon method={method} className="h-8 w-8" />
                        <span>{PAYMENT_METHOD_LABELS[method]}</span>
                      </>
                    )}
                  </Button>
                ))}
              </div>
              <DialogFooter className="flex-row justify-between sm:justify-between">
                {total > 0 && (
                  <Button
                    variant="link"
                    className="text-purple-600 px-0"
                    onClick={() => {
                      setIsSplitMode(true);
                      setSplitAmount(total.toFixed(2));
                    }}
                    disabled={isSubmitting}
                  >
                    Split Payment
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setIsPaymentOpen(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-4 py-2">
              {/* Added splits */}
              {splitPayments.length > 0 && (
                <div className="space-y-2">
                  {splitPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between p-2 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <PaymentMethodIcon method={payment.method} className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {currencySymbol}{payment.amount.toFixed(2)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => removeSplitPayment(payment.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new split row */}
              {!isSplitComplete && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Method</Label>
                    <Select
                      value={splitMethod}
                      onValueChange={(v) => setSplitMethod(v as PaymentMethod)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SELECTABLE_PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={splitRemaining}
                      value={splitAmount}
                      onChange={(e) => {
                        if (e.target.value.startsWith('-')) return;
                        setSplitAmount(e.target.value);
                      }}
                      className="h-9"
                      placeholder="0.00"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={addSplitPayment}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Remaining bar */}
              <div className={`flex justify-between items-center p-2 rounded-lg text-sm font-medium ${
                isSplitComplete
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
              }`}>
                <span>Remaining</span>
                <span>{currencySymbol}{Math.max(0, splitRemaining).toFixed(2)}</span>
              </div>

              <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsSplitMode(false);
                    setSplitPayments([]);
                    setSplitAmount("");
                    setSplitMethod(PaymentMethod.CASH);
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button
                  onClick={handleSplitComplete}
                  disabled={!isSplitComplete || splitPayments.length === 0 || isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Complete Payment
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
