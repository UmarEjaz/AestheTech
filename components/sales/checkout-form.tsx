"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
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
  Package,
  AlertTriangle,
  ChevronsUpDown,
  Check,
  MoreHorizontal,
  StickyNote,
  X,
  ChevronDown,
  CalendarDays,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { createWalkInClient } from "@/lib/actions/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { quickSale } from "@/lib/actions/sale";
import { getActiveProducts } from "@/lib/actions/product";
import { PaymentMethod } from "@prisma/client";
import { PaymentMethodIcon, PAYMENT_METHOD_LABELS, SELECTABLE_PAYMENT_METHODS } from "@/lib/constants/payment-methods";
import { formatCurrency } from "@/lib/utils/currency";
import { getCurrencySymbol } from "@/lib/currencies";

interface CartItem {
  id: string;
  type: "service" | "product";
  serviceId?: string;
  productId?: string;
  name: string;
  staffId?: string;
  staffName?: string;
  price: number;
  quantity: number;
  points: number;
  maxQuantity?: number; // stock limit for products
  discount?: number; // per-line discount amount (currency), already resolved from $/%
  note?: string; // per-line note (colour formula, special request, etc.)
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

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string | null;
  points: number;
  sku: string | null;
  lowStockThreshold: number;
}

interface Staff {
  id: string;
  firstName: string;
  lastName: string;
}

interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string[];
  disabled?: boolean;
}

// Searchable single-select combobox (Popover + Command) — same control as the booking form's
// service/staff pickers. Type to filter, arrow keys + Enter to choose. Scales to long catalogs.
function ComboBox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText = "No match.",
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ComboOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  keywords={o.keywords}
                  disabled={o.disabled}
                  onSelect={() => {
                    if (o.disabled) return;
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{o.label}</div>
                    {o.sublabel && <div className="truncate text-xs text-muted-foreground">{o.sublabel}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface SplitPayment {
  id: number;
  method: PaymentMethod;
  amount: string; // raw input string for inline editing; parsed for totals
}

/** When checking out an appointment: lock the client, seed the cart, and apply the deposit. */
interface AppointmentContext {
  appointmentId: string;
  client: Client;
  depositPaid: number;
  seedItems: CartItem[];
  staffId: string;
  /** Preformatted "Wed, Jul 15, 2026 · 2:30 PM – 2:50 PM" in the salon timezone. */
  scheduleLabel: string;
  /** The originally booked services, for the compact appointment summary. */
  bookedServices: { name: string; staffName: string; durationMin: number; price: number }[];
}

interface CheckoutFormProps {
  clients: Client[];
  services: Service[];
  products?: Product[];
  staff: Staff[];
  currencyCode: string;
  taxRate: number;
  pointsPerDollar: number;
  loyaltyProgramEnabled?: boolean;
  /** Allow taking a partial payment at checkout. */
  allowPartialPayment?: boolean;
  /** Allow creating a fully-unpaid (pay-later) invoice. Implies partial is allowed. */
  allowPayLater?: boolean;
  /** Present when this checkout is for an appointment. */
  appointmentContext?: AppointmentContext;
  /** Whether the current user may apply discounts (whole-bill or per-line). */
  canDiscount?: boolean;
}

export function CheckoutForm({
  clients,
  services,
  products = [],
  staff,
  currencyCode,
  taxRate,
  pointsPerDollar,
  loyaltyProgramEnabled = true,
  allowPartialPayment = false,
  allowPayLater = false,
  appointmentContext,
  canDiscount = false,
}: CheckoutFormProps) {
  const router = useRouter();
  // Deferred-payment availability (full pay-later implies partial is allowed too).
  const canPartial = allowPartialPayment || allowPayLater;
  const canPayLater = allowPayLater;
  const canDefer = canPartial || canPayLater;
  const [selectedClient, setSelectedClient] = useState<Client | null>(appointmentContext?.client ?? null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>(appointmentContext ? appointmentContext.seedItems : []);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">("fixed");
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingMethod, setSubmittingMethod] = useState<PaymentMethod | null>(null);
  // The "add a line" flow (like the appointment form): pick a service + who performs it, then Add —
  // no page-level staff select, no grid of cards. Products: pick + quantity, then Add.
  const [activeItemTab, setActiveItemTab] = useState<"services" | "products">("services");
  const [pendingService, setPendingService] = useState("");
  const [pendingStaff, setPendingStaff] = useState<string>(appointmentContext?.staffId || staff[0]?.id || "");
  const [pendingProduct, setPendingProduct] = useState("");
  const [pendingQty, setPendingQty] = useState(1);
  // Collapse the "add items" section by default when checking out an appointment (the booked
  // service is already in the cart); keep it open for a fresh sale where you must add items.
  const [itemsOpen, setItemsOpen] = useState(!appointmentContext);
  // Cart line pending removal — drives the "Remove this item?" confirmation dialog.
  const [itemToRemove, setItemToRemove] = useState<CartItem | null>(null);

  // A sale uses ONE discount approach at a time to avoid ambiguity: the whole bill, or per line.
  const [discountMode, setDiscountMode] = useState<"whole" | "item">("whole");
  const switchDiscountMode = (mode: "whole" | "item") => {
    setDiscountMode(mode);
    if (mode === "whole") {
      // Leaving per-item mode clears any per-line discounts so they can't apply invisibly.
      setCart((c) => c.map((it) => ({ ...it, discount: 0 })));
      setLineUI({});
    } else {
      setDiscount(0); // Leaving whole-bill mode clears the whole-bill discount.
    }
  };

  // Per-line discount/note reveal state (which line has its discount/note editor open).
  const [lineUI, setLineUI] = useState<Record<string, { discount?: boolean; note?: boolean }>>({});
  const setLineUIOpen = (id: string, key: "discount" | "note", open: boolean) =>
    setLineUI((prev) => ({ ...prev, [id]: { ...prev[id], [key]: open } }));

  // Persist the in-progress checkout (cart, per-line notes/discounts, discount mode, redeemed
  // points) to sessionStorage so an accidental refresh doesn't wipe unsaved edits. Scoped to
  // this appointment (or a fresh sale) and cleared once the sale is completed (see handleQuickSale).
  const storageKey = `checkout:${appointmentContext?.appointmentId ?? "new-sale"}`;
  const persistHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.cart)) setCart(saved.cart);
        if (typeof saved.discount === "number") setDiscount(saved.discount);
        if (saved.discountType === "fixed" || saved.discountType === "percentage") setDiscountType(saved.discountType);
        if (saved.discountMode === "whole" || saved.discountMode === "item") setDiscountMode(saved.discountMode);
        if (typeof saved.redeemPoints === "number") setRedeemPoints(saved.redeemPoints);
      }
    } catch {
      // Corrupt/blocked storage — ignore and start fresh.
    }
    // Run once on mount for this checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    // Skip the first run so we never clobber saved data with the initial seed state.
    if (!persistHydratedRef.current) {
      persistHydratedRef.current = true;
      return;
    }
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ cart, discount, discountType, discountMode, redeemPoints })
      );
    } catch {
      // Storage full/blocked — non-fatal.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, discount, discountType, discountMode, redeemPoints]);
  const setLineDiscount = (id: string, val: number) =>
    setCart((c) => c.map((it) => (it.id === id ? { ...it, discount: Math.max(0, Math.min(val, it.price * it.quantity)) } : it)));
  const setLineNote = (id: string, val: string) =>
    setCart((c) => c.map((it) => (it.id === id ? { ...it, note: val } : it)));

  // Split payment state — each row is inline-editable.
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [splitIdCounter, setSplitIdCounter] = useState(0);
  // Due date for the balance when a sale is paid partially / not at all.
  const [dueDate, setDueDate] = useState("");
  // Distinguishes the two split-screen flows: false = "Split Payment" (pay the
  // full total across methods), true = "Partial payment or pay later" (partial/unpaid + due date).
  const [payLaterMode, setPayLaterMode] = useState(false);
  // Format/compare due dates against the user's LOCAL calendar day. Using
  // toISOString() (UTC) here would shift the day by one near timezone boundaries.
  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const todayStr = () => formatLocalDate(new Date());
  const defaultDueDateStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return formatLocalDate(d);
  };

  // Walk-in client state
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  // Calculate totals. Per-line discounts come off first, then the whole-bill discount applies to the
  // net. `discountAmount` is the combined total (shown as one "Discount" line), matching the backend.
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemDiscountTotal = cart.reduce((sum, item) => sum + Math.min(item.discount ?? 0, item.price * item.quantity), 0);
  const subtotalNet = Math.max(0, subtotal - itemDiscountTotal);
  const overallDiscount = Math.min(discountType === "percentage" ? (subtotalNet * discount) / 100 : discount, subtotalNet);
  const discountAmount = itemDiscountTotal + overallDiscount;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const pointsValue = redeemPoints / pointsPerDollar;
  const afterPoints = Math.max(0, afterDiscount - pointsValue);
  const taxAmount = (afterPoints * taxRate) / 100;
  const total = afterPoints + taxAmount;

  // Deposit already taken (appointment checkout). Payments at this step collect the
  // BALANCE; the deposit is applied server-side toward the full invoice total.
  const depositPaid = appointmentContext?.depositPaid ?? 0;
  const payableNow = Math.max(0, Math.round((total - depositPaid) * 100) / 100);
  // If the deposit exceeds the total (e.g. a service was removed after booking), the
  // excess is refunded to the client in cash at checkout.
  const refundDue = Math.max(0, Math.round((depositPaid - total) * 100) / 100);

  // Calculate points to be earned
  const pointsToEarn = cart.reduce((sum, item) => sum + item.points * item.quantity, 0);

  // Staff is chosen at add-time (like the appointment form) and baked into the line, so the cart
  // shows "by <staff>" as plain text — no per-line dropdown cluttering the cart.
  const addServiceToCart = (service: Service, staffId: string) => {
    const existingItem = cart.find(
      (item) => item.type === "service" && item.serviceId === service.id && item.staffId === staffId
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
      const staffMember = staff.find((s) => s.id === staffId);
      setCart([
        ...cart,
        {
          id: `service-${service.id}-${staffId}-${Date.now()}`,
          type: "service",
          serviceId: service.id,
          name: service.name,
          staffId: staffId,
          staffName: staffMember ? `${staffMember.firstName} ${staffMember.lastName}` : "",
          price: Number(service.price),
          quantity: 1,
          points: service.points,
        },
      ]);
    }
    toast.success(`${service.name} added to cart`);
  };

  const addProductToCart = (product: Product, qty = 1) => {
    if (product.stock <= 0) return;

    const existingItem = cart.find(
      (item) => item.type === "product" && item.productId === product.id
    );

    if (existingItem) {
      const stockLimit = existingItem.maxQuantity ?? product.stock;
      const nextQty = Math.min(stockLimit, existingItem.quantity + qty);
      if (nextQty <= existingItem.quantity) {
        toast.error(`Only ${stockLimit} in stock`);
        return;
      }
      setCart(
        cart.map((item) =>
          item.id === existingItem.id ? { ...item, quantity: nextQty } : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          id: `product-${product.id}-${Date.now()}`,
          type: "product",
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: Math.min(product.stock, Math.max(1, qty)),
          points: product.points,
          maxQuantity: product.stock,
        },
      ]);
    }
    toast.success(`${product.name} added to cart`);
  };

  // "Add" button handlers for the pick-then-add rows.
  const addPendingService = () => {
    const svc = services.find((s) => s.id === pendingService);
    if (!svc || !pendingStaff) return;
    addServiceToCart(svc, pendingStaff);
    setPendingService("");
  };
  const addPendingProduct = () => {
    const prod = products.find((p) => p.id === pendingProduct);
    if (!prod) return;
    addProductToCart(prod, pendingQty);
    setPendingProduct("");
    setPendingQty(1);
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(
      cart
        .map((item) => {
          if (item.id !== itemId) return item;
          const newQty = Math.max(0, item.quantity + delta);
          // Respect stock limit for products
          if (item.maxQuantity !== undefined && newQty > item.maxQuantity) {
            toast.error(`Only ${item.maxQuantity} in stock`);
            return item;
          }
          return { ...item, quantity: newQty };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const removeItem = (itemId: string) => {
    setCart(cart.filter((item) => item.id !== itemId));
  };

  // Reset split entries if the cart total changes while in split mode (safety net).
  const prevTotalRef = useRef(total);
  useEffect(() => {
    if (isSplitMode && prevTotalRef.current !== total && splitPayments.length > 0) {
      setSplitPayments([]);
      toast.info("Cart total changed — split payments have been reset.");
    }
    prevTotalRef.current = total;
  }, [total, isSplitMode, splitPayments.length]);

  // Split payment helpers — round each row ONCE and reuse it for both the
  // "balanced?" check and the submitted payload, so the UI's completeness can't
  // drift a cent from what actually gets saved.
  const normalizedSplitRows = splitPayments
    .map((p) => ({ method: p.method, amount: Math.round((parseFloat(p.amount) || 0) * 100) / 100 }))
    .filter((p) => p.amount > 0);
  const splitTotal =
    Math.round(normalizedSplitRows.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const splitRemaining = Math.round((payableNow - splitTotal) * 100) / 100;
  const isSplitComplete = Math.abs(splitRemaining) < 0.01 && splitTotal > 0;

  // Add an editable row, pre-filled with whatever balance is left (or empty).
  const addSplitRow = () => {
    const nextId = splitIdCounter + 1;
    setSplitIdCounter(nextId);
    setSplitPayments((rows) => [
      ...rows,
      {
        id: nextId,
        method: PaymentMethod.CASH,
        amount: splitRemaining > 0 ? splitRemaining.toFixed(2) : "",
      },
    ]);
  };

  const updateSplitRow = (id: number, patch: Partial<Omit<SplitPayment, "id">>) => {
    setSplitPayments((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeSplitRow = (id: number) => {
    setSplitPayments((rows) => rows.filter((r) => r.id !== id));
  };

  // Same normalized rows used for the balance check above — one source of truth.
  const splitPaymentsForSubmit = () => normalizedSplitRows;

  const submitPayment = async (
    payments: { method: PaymentMethod; amount: number }[],
    saleDueDate?: Date
  ) => {
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
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          discount: item.discount ?? 0,
          note: item.note?.trim() || "",
        })),
        discount,
        discountType,
        payments,
        redeemPoints: isWalkIn ? 0 : redeemPoints,
        dueDate: saleDueDate,
        appointmentId: appointmentContext?.appointmentId,
      });

      if (result.success) {
        // Sale is saved — drop the in-progress draft so it can't restore on the next checkout.
        try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
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
    submitPayment([{ method, amount: payableNow }]);
  };

  const handleSplitComplete = () => {
    if (!isSplitComplete) return;
    submitPayment(splitPaymentsForSubmit());
  };

  // Partial / pay-later: submit with the partial (or empty) payments + a due date
  // for the remaining balance.
  const handlePartialComplete = () => {
    if (!dueDate) {
      toast.error("Pick a due date for the remaining balance");
      return;
    }
    if (dueDate < todayStr()) {
      toast.error("Due date can't be in the past");
      return;
    }
    if (splitTotal === 0 && !canPayLater) {
      toast.error("Pay-later isn't enabled — take a partial payment or collect the full amount.");
      return;
    }
    if (splitTotal > 0 && splitTotal < total && !canPartial) {
      toast.error("Partial payments aren't enabled — collect the full amount.");
      return;
    }
    submitPayment(splitPaymentsForSubmit(), new Date(`${dueDate}T00:00:00`));
  };

  // Enter "Split Payment": pay the full total across methods. Seed the two most
  // common tenders (Cash + Card) with empty amounts for the cashier to fill in.
  const startSplit = () => {
    setIsSplitMode(true);
    setPayLaterMode(false);
    const id1 = splitIdCounter + 1;
    const id2 = splitIdCounter + 2;
    setSplitIdCounter(id2);
    setSplitPayments([
      { id: id1, method: PaymentMethod.CASH, amount: "" },
      { id: id2, method: PaymentMethod.CARD, amount: "" },
    ]);
  };

  // Enter "Partial payment or pay later": start with no rows (full balance due); the user
  // can add a partial-payment row. Default the due date to +7 days.
  const startPayLater = () => {
    setIsSplitMode(true);
    setPayLaterMode(true);
    setSplitPayments([]);
    if (!dueDate) setDueDate(defaultDueDateStr());
  };

  // Refresh stock for product cart items before opening payment modal
  const handleProceedToPayment = async () => {
    const productItems = cart.filter((item) => item.type === "product" && item.productId);
    if (productItems.length > 0) {
      const result = await getActiveProducts();
      if (result.success) {
        const stockMap = new Map(result.data.map((p) => [p.id, p.stock]));
        let hasStockIssue = false;

        const updatedCart = cart.map((item) => {
          if (item.type !== "product" || !item.productId) return item;
          const currentStock = stockMap.get(item.productId) ?? 0;
          if (item.quantity > currentStock) {
            hasStockIssue = true;
            toast.error(`"${item.name}" stock changed: only ${currentStock} available (you have ${item.quantity} in cart)`);
          }
          return { ...item, maxQuantity: currentStock };
        });

        setCart(updatedCart);
        if (hasStockIssue) return;
      }
    }
    // Start the modal clean (method picker), clearing any prior split/pay-later state.
    setIsSplitMode(false);
    setPayLaterMode(false);
    setSplitPayments([]);
    setDueDate("");
    setIsPaymentOpen(true);
  };

  const getInitials = (firstName: string, lastName: string | null) => {
    return `${firstName[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  // Options for the searchable service / staff / product pickers (the "add a line" flow).
  const serviceOptions: ComboOption[] = services.map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: `${formatCurrency(Number(s.price), currencyCode)} · ${s.duration}min`,
  }));
  const staffOptions: ComboOption[] = staff.map((m) => ({
    value: m.id,
    label: `${m.firstName} ${m.lastName}`,
  }));
  const productOptions: ComboOption[] = products.map((p) => ({
    value: p.id,
    label: p.name,
    // Products are searchable by SKU too (also lets a barcode scanner find them).
    keywords: p.sku ? [p.sku] : undefined,
    sublabel: `${formatCurrency(Number(p.price), currencyCode)} · ${p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}`,
    disabled: p.stock <= 0,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-24 lg:pb-0">
      {/* Left: Service/Product Selection */}
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
            {/* Walk-in Toggle — hidden when checking out an appointment (client is locked) */}
            {!appointmentContext && (
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
                  setRedeemPoints(0);
                }}
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Walk-in Client
              </Button>
            </div>
            )}

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
                      {selectedClient.loyaltyPoints.tier !== "MEMBER" && (
                        <Badge variant="outline" className="text-xs">
                          {selectedClient.loyaltyPoints.tier}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                {!appointmentContext && (
                  <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                    Change
                  </Button>
                )}
              </div>
            ) : (
              /* Searchable combobox — same control as the booking form: type to filter ALL clients
                 (not just the first 5), keyboard-navigable, one click to select. */
              <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="text-muted-foreground">Search or select a client…</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name or phone…" />
                    <CommandList>
                      <CommandEmpty>No clients found.</CommandEmpty>
                      <CommandGroup>
                        {clients.map((client) => {
                          const label = `${client.firstName} ${client.lastName || ""}`.trim();
                          return (
                            <CommandItem
                              key={client.id}
                              value={`${label} ${client.phone || ""}`}
                              onSelect={() => {
                                setSelectedClient(client);
                                setRedeemPoints(0);
                                setClientPickerOpen(false);
                              }}
                            >
                              <Avatar className="mr-2 h-7 w-7">
                                <AvatarFallback className="text-[10px]">
                                  {getInitials(client.firstName, client.lastName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-sm font-medium">{label}</span>
                                  {client.isWalkIn && (
                                    <Badge variant="secondary" className="text-[10px]">Walk-in</Badge>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {client.phone || "No phone"}
                                </span>
                              </div>
                              {loyaltyProgramEnabled && client.loyaltyPoints && (
                                <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
                                  {client.loyaltyPoints.balance} pts
                                </Badge>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </CardContent>
        </Card>

        {/* Compact appointment summary — what was booked, when, and the deposit. Gives staff
            context and surfaces the money early without bloating the page. Appointment checkout only. */}
        {appointmentContext && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-primary" />
                Appointment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {appointmentContext.bookedServices.map((svc, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Scissors className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{svc.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {svc.staffName}
                      {svc.durationMin > 0 ? ` · ${svc.durationMin} min` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold">{formatCurrency(svc.price, currencyCode)}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 border-t pt-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarDays className="h-4 w-4" />
                </span>
                <p className="text-sm">{appointmentContext.scheduleLabel}</p>
              </div>
              {appointmentContext.depositPaid > 0 && (
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <Wallet className="h-4 w-4" />
                  </span>
                  <p className="text-sm">
                    <span className="font-semibold text-green-700 dark:text-green-400">
                      {formatCurrency(appointmentContext.depositPaid, currencyCode)}
                    </span>{" "}
                    deposit paid
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Items — pick a service + who performs it (or a product + qty), then Add. Like the
            appointment form: staff is chosen per line at add-time (no page-level staff select,
            no grid of cards), so each line keeps its own provider. */}
        {!itemsOpen ? (
          // Collapsed: a compact "add" bar, not a big empty card.
          <button
            type="button"
            onClick={() => setItemsOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border bg-card px-6 py-4 text-left shadow-sm transition-colors hover:bg-muted/50"
          >
            <Plus className="h-4 w-4 text-primary" />
            <span className="font-semibold">Add extra service / product</span>
            <ChevronDown className="ml-auto h-5 w-5 text-muted-foreground" />
          </button>
        ) : (
        <Card>
          <CardHeader className="cursor-pointer pb-3" onClick={() => setItemsOpen(false)}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Items</CardTitle>
                <CardDescription>Pick an item and add it to the cart</CardDescription>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 rotate-180 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {staff.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No service providers found. Mark a staff member as a{" "}
                <span className="font-medium text-foreground">Service Provider</span> on the{" "}
                <Link href="/dashboard/staff" className="font-medium text-primary underline underline-offset-2">
                  Staff
                </Link>{" "}
                page to sell services.
              </p>
            ) : (
            <Tabs value={activeItemTab} onValueChange={(v) => setActiveItemTab(v as "services" | "products")}>
              {/* Full-width tabs now that there's no search bar sharing the row. */}
              <TabsList className={cn("mb-4", products.length > 0 && "grid w-full grid-cols-2")}>
                <TabsTrigger value="services" className="gap-2">
                  <Scissors className="h-4 w-4" />
                  Services
                </TabsTrigger>
                {products.length > 0 && (
                  <TabsTrigger value="products" className="gap-2">
                    <Package className="h-4 w-4" />
                    Products
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="services">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <ComboBox
                    value={pendingService}
                    onValueChange={setPendingService}
                    options={serviceOptions}
                    placeholder="Select a service"
                    searchPlaceholder="Search services…"
                    emptyText="No matching service."
                  />
                  <ComboBox
                    value={pendingStaff}
                    onValueChange={setPendingStaff}
                    options={staffOptions}
                    placeholder="Select staff"
                    searchPlaceholder="Search staff…"
                    emptyText="No matching staff."
                  />
                  <Button type="button" onClick={addPendingService} disabled={!pendingService || !pendingStaff}>
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Pick the service and who&apos;s performing it, then Add — each line keeps its own staff.
                </p>
              </TabsContent>

              {products.length > 0 && (
                <TabsContent value="products">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <ComboBox
                      value={pendingProduct}
                      onValueChange={setPendingProduct}
                      options={productOptions}
                      placeholder="Select a product"
                      searchPlaceholder="Scan barcode or search by name / SKU…"
                      emptyText="No matching product."
                    />
                    <Input
                      type="number"
                      min={1}
                      value={pendingQty}
                      onChange={(e) => setPendingQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-20"
                      aria-label="Quantity"
                    />
                    <Button type="button" onClick={addPendingProduct} disabled={!pendingProduct}>
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Search by name or SKU (a barcode scanner works too), set the quantity, then Add.
                  </p>
                </TabsContent>
              )}
            </Tabs>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Right: Cart */}
      <div id="checkout-cart" className="space-y-4">
        <Card className="sticky top-4">
          <CardHeader className="border-b pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Cart
              </CardTitle>
              <CardDescription>
                {cart.length} {cart.length === 1 ? "item" : "items"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {cart.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Cart is empty. Add services or products to begin.
              </p>
            ) : (
              <>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {cart.map((item) => {
                    const gross = item.price * item.quantity;
                    const disc = Math.min(item.discount ?? 0, gross);
                    const ui = lineUI[item.id];
                    return (
                    <div key={item.id} className="rounded-lg bg-muted/50 p-2">
                      {/* Top row: name + staff on the left, price stacked on the right. */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-sm truncate">{item.name}</p>
                            {item.type === "product" && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">Product</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.staffName ? `by ${item.staffName}` : "Retail · no staff"}
                          </p>
                        </div>
                        <div className="shrink-0 whitespace-nowrap text-right">
                          <div className="text-sm font-bold">{formatCurrency(gross - disc, currencyCode)}</div>
                          {disc > 0 && (
                            <>
                              <div className="text-xs text-muted-foreground line-through">
                                {formatCurrency(gross, currencyCode)}
                              </div>
                              <div className="group/disc flex items-center justify-end gap-1 text-xs font-semibold text-green-600">
                                <button
                                  type="button"
                                  title="Remove discount"
                                  className="order-first text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/disc:opacity-100"
                                  onClick={() => setLineDiscount(item.id, 0)}
                                >
                                  <X className="inline h-3 w-3" />
                                  <span className="sr-only">Remove discount</span>
                                </button>
                                <span>−{formatCurrency(disc, currencyCode)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {item.note && !ui?.note && (
                        <div className="group/note mt-2 flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs text-purple-800 dark:border-purple-900/50 dark:bg-purple-900/20 dark:text-purple-200">
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="min-w-0 flex-1 cursor-default truncate">📝 {item.note}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs border-purple-600 bg-purple-600 text-white">
                                {item.note}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <button
                            type="button"
                            title="Remove note"
                            className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover/note:opacity-100"
                            onClick={() => setLineNote(item.id, "")}
                          >
                            <X className="h-3 w-3" />
                            <span className="sr-only">Remove note</span>
                          </button>
                        </div>
                      )}

                      {/* Controls row: quantity stepper on the left, actions on the right. */}
                      <div className="mt-2.5 flex items-center justify-between">
                        <div className="inline-flex items-center rounded-md border">
                          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => updateQuantity(item.id, -1)}>
                            <Minus className="h-3 w-3" />
                            <span className="sr-only">Decrease quantity</span>
                          </Button>
                          <span className="w-8 border-x text-center text-sm leading-7">{item.quantity}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => updateQuantity(item.id, 1)}>
                            <Plus className="h-3 w-3" />
                            <span className="sr-only">Increase quantity</span>
                          </Button>
                        </div>
                        <div className="flex items-center gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon" className="h-7 w-7 text-muted-foreground">
                                <MoreHorizontal className="h-3 w-3" />
                                <span className="sr-only">Line options</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canDiscount && discountMode === "item" && (
                                <DropdownMenuItem onClick={() => setLineUIOpen(item.id, "discount", true)}>
                                  <Percent className="mr-2 h-4 w-4" />
                                  {item.discount ? "Edit discount" : "Apply discount"}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setLineUIOpen(item.id, "note", true)}>
                                <StickyNote className="mr-2 h-4 w-4" />
                                {item.note ? "Edit note" : "Add note"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button variant="outline" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setItemToRemove(item)}>
                            <Trash2 className="h-3 w-3" />
                            <span className="sr-only">Remove item</span>
                          </Button>
                        </div>
                      </div>
                      {canDiscount && discountMode === "item" && ui?.discount && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Discount</span>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.discount || ""}
                              onChange={(e) => setLineDiscount(item.id, parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setLineUIOpen(item.id, "discount", false); } }}
                              className="h-7 w-24 pl-5 text-sm"
                              placeholder="0.00"
                              autoFocus
                            />
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-primary" title="Done" onClick={() => setLineUIOpen(item.id, "discount", false)}>
                            <Check className="h-4 w-4" />
                            <span className="sr-only">Done</span>
                          </Button>
                          {(item.discount ?? 0) > 0 && (
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Clear discount" onClick={() => { setLineDiscount(item.id, 0); setLineUIOpen(item.id, "discount", false); }}>
                              <X className="h-4 w-4" />
                              <span className="sr-only">Clear discount</span>
                            </Button>
                          )}
                        </div>
                      )}
                      {ui?.note && (
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            value={item.note ?? ""}
                            onChange={(e) => setLineNote(item.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setLineUIOpen(item.id, "note", false); } }}
                            className="h-7 flex-1 text-sm"
                            placeholder="Add a note for this item…"
                            autoFocus
                          />
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-primary" title="Done" onClick={() => setLineUIOpen(item.id, "note", false)}>
                            <Check className="h-4 w-4" />
                            <span className="sr-only">Done</span>
                          </Button>
                          {item.note && (
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" title="Clear note" onClick={() => { setLineNote(item.id, ""); setLineUIOpen(item.id, "note", false); }}>
                              <X className="h-4 w-4" />
                              <span className="sr-only">Clear note</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                <Separator />

                {/* Discount — only for users with the sales:discount permission. A sale uses ONE
                    approach at a time (whole bill OR per line) so it's never ambiguous. */}
                {canDiscount && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1">
                      <Percent className="h-3 w-3" />
                      Discount
                    </Label>
                    <div className="inline-flex rounded-md border p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => switchDiscountMode("whole")}
                        className={cn("rounded px-2 py-0.5 font-medium", discountMode === "whole" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        Entire sale
                      </button>
                      <button
                        type="button"
                        onClick={() => switchDiscountMode("item")}
                        className={cn("rounded px-2 py-0.5 font-medium", discountMode === "item" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        Per item
                      </button>
                    </div>
                  </div>
                  {discountMode === "whole" ? (
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
                          <SelectItem value="fixed">{getCurrencySymbol(currencyCode)}</SelectItem>
                          <SelectItem value="percentage">%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Discount individual items using the <span className="font-medium">⋯</span> on each item. Switch to{" "}
                      <span className="font-medium">Entire sale</span> to discount the <span className="font-medium">total</span>.
                    </p>
                  )}
                </div>
                )}

                {/* Loyalty Points Redemption */}
                {loyaltyProgramEnabled && selectedClient?.loyaltyPoints && selectedClient.loyaltyPoints.balance > 0 && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      Redeem Points ({pointsPerDollar} pts = {formatCurrency(1, currencyCode)})
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
                    <span>{formatCurrency(subtotal, currencyCode)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount</span>
                      <span>-{formatCurrency(discountAmount, currencyCode)}</span>
                    </div>
                  )}
                  {loyaltyProgramEnabled && redeemPoints > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Points Redeemed ({redeemPoints})</span>
                      <span>-{formatCurrency(pointsValue, currencyCode)}</span>
                    </div>
                  )}
                  {taxRate > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                      <span>{formatCurrency(taxAmount, currencyCode)}</span>
                    </div>
                  )}
                  <Separator />
                  {/* Total sits just above the line items in size (16px vs 14px) so the hierarchy
                      is gentle; the purple Balance-due box below is the real focal point. */}
                  <div className="flex justify-between text-base font-bold">
                    <span>Total</span>
                    <span className="text-purple-600">{formatCurrency(total, currencyCode)}</span>
                  </div>
                  {depositPaid > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                        <span>Deposit paid</span>
                        <span>-{formatCurrency(depositPaid, currencyCode)}</span>
                      </div>
                      {refundDue > 0 ? (
                        <div className="mt-1 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 dark:border-rose-900/50 dark:bg-rose-900/20">
                          <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Refund to client</span>
                          <span className="text-xl font-extrabold text-rose-700 dark:text-rose-300">{formatCurrency(refundDue, currencyCode)}</span>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-3 dark:border-purple-900/50 dark:bg-purple-900/20">
                          <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">Balance due now</span>
                          <span className="text-xl font-extrabold text-purple-700 dark:text-purple-300">{formatCurrency(payableNow, currencyCode)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {loyaltyProgramEnabled && pointsToEarn > 0 && (
                    <div className="flex items-center justify-center gap-1 pt-1 text-sm font-semibold text-green-600 dark:text-green-400">
                      <Star className="h-3.5 w-3.5 fill-current" />
                      Points to earn +{pointsToEarn}
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
              onClick={handleProceedToPayment}
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
            setPayLaterMode(false);
            setSplitPayments([]);
            setDueDate("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isSplitMode
                ? payLaterMode
                  ? canPayLater
                    ? "Partial payment or pay later"
                    : "Partial payment"
                  : "Split Payment"
                : "Select Payment Method"}
            </DialogTitle>
            <DialogDescription>
              Total: {formatCurrency(total, currencyCode)}
              {depositPaid > 0 && (
                <>
                  {" · "}Deposit: {formatCurrency(depositPaid, currencyCode)}
                  {" · "}Balance due: {formatCurrency(payableNow, currencyCode)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {payableNow <= 0 && total > 0 ? (
            /* Deposit already covers the full amount — just complete the sale. */
            <>
              <p className="py-4 text-center text-sm text-muted-foreground">
                {refundDue > 0 ? (
                  <>
                    The {formatCurrency(depositPaid, currencyCode)} deposit exceeds the {formatCurrency(total, currencyCode)} total.
                    Complete the sale and <span className="font-semibold text-rose-700 dark:text-rose-300">refund {formatCurrency(refundDue, currencyCode)}</span> to the client.
                  </>
                ) : (
                  <>Fully covered by the {formatCurrency(depositPaid, currencyCode)} deposit. Nothing left to collect.</>
                )}
              </p>
              <DialogFooter className="flex-row justify-end">
                <Button onClick={() => submitPayment([])} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Complete sale
                </Button>
              </DialogFooter>
            </>
          ) : !isSplitMode ? (
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
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="link"
                      className="text-purple-600 px-0"
                      onClick={startSplit}
                      disabled={isSubmitting}
                    >
                      Split Payment
                    </Button>
                    {canDefer && (
                      <Button
                        variant="link"
                        className="text-purple-600 px-0"
                        onClick={startPayLater}
                        disabled={isSubmitting}
                      >
                        {canPayLater ? "Partial payment or pay later" : "Partial payment"}
                      </Button>
                    )}
                  </div>
                )}
                <Button variant="ghost" onClick={() => setIsPaymentOpen(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-4 py-2">
              {/* Editable payment rows — what you see is what gets recorded */}
              <div className="space-y-2">
                {splitPayments.length === 0 && (
                  <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                    {payLaterMode
                      ? canPayLater
                        ? "No payment yet — add a partial payment, or leave empty to invoice the full amount."
                        : "Add a partial payment below — the rest will be invoiced as due."
                      : "No payments yet — add a method below."}
                  </p>
                )}
                {splitPayments.map((row) => (
                  <div key={row.id} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">Method</Label>
                      <Select
                        value={row.method}
                        onValueChange={(v) => updateSplitRow(row.id, { method: v as PaymentMethod })}
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
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => {
                          if (e.target.value.startsWith("-")) return;
                          updateSplitRow(row.id, { amount: e.target.value });
                        }}
                        className="h-9"
                        placeholder="0.00"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-destructive"
                      onClick={() => removeSplitRow(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove payment line</span>
                    </Button>
                  </div>
                ))}
              </div>

              {/* Add method */}
              <Button variant="outline" size="sm" className="w-full" onClick={addSplitRow}>
                <Plus className="h-4 w-4 mr-2" />
                Add method
              </Button>

              {/* Running balance bar */}
              <div className={`flex justify-between items-center p-2 rounded-lg text-sm font-medium ${
                splitRemaining < -0.01
                  ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                  : isSplitComplete
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
              }`}>
                <span>
                  {splitRemaining < -0.01
                    ? "Over by"
                    : payLaterMode && !isSplitComplete
                    ? "Balance due"
                    : "Remaining"}
                </span>
                <span>{formatCurrency(Math.abs(splitRemaining), currencyCode)}</span>
              </div>
              {splitRemaining < -0.01 && (
                <p className="text-xs text-red-600">Payments exceed the total — reduce an amount to continue.</p>
              )}

              {/* Due date for the balance — only in the partial / pay-later flow */}
              {payLaterMode && !isSplitComplete && (
                <div>
                  <Label className="text-xs">Due date for balance</Label>
                  <Input
                    type="date"
                    min={todayStr()}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-9"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCurrency(Math.max(0, splitRemaining), currencyCode)} will be invoiced as
                    {splitTotal > 0 ? " partially paid" : " unpaid"} and due by this date.
                  </p>
                </div>
              )}

              <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsSplitMode(false);
                    setPayLaterMode(false);
                    setSplitPayments([]);
                    setDueDate("");
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                {payLaterMode && !isSplitComplete ? (
                  <Button
                    onClick={handlePartialComplete}
                    disabled={
                      !dueDate ||
                      isSubmitting ||
                      splitRemaining < -0.01 ||
                      (splitTotal === 0 && !canPayLater)
                    }
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {splitTotal > 0
                      ? `Charge ${formatCurrency(splitTotal, currencyCode)} · invoice rest`
                      : canPayLater
                        ? "Record as unpaid"
                        : "Add a payment to continue"}
                  </Button>
                ) : (
                  <Button
                    onClick={handleSplitComplete}
                    disabled={!isSplitComplete || splitPayments.length === 0 || isSubmitting}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Complete Payment
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm before removing a cart line (the trash sits next to the discount, so a tap could be a mis-hit). */}
      <AlertDialog open={!!itemToRemove} onOpenChange={(open) => { if (!open) setItemToRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove item?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-medium text-foreground">{itemToRemove?.name}</span> from the cart?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (itemToRemove) removeItem(itemToRemove.id); setItemToRemove(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile-only sticky mini-cart — desktop keeps the sidebar cart (this is lg:hidden), so it
          only affects the phone/tablet view. Tapping scrolls to the full cart to review & pay. */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {cart.reduce((n, i) => n + i.quantity, 0)} item{cart.reduce((n, i) => n + i.quantity, 0) !== 1 ? "s" : ""}
                {" · "}{depositPaid > 0 ? "balance due" : "total"}
              </p>
              <p className="text-lg font-bold">{formatCurrency(payableNow, currencyCode)}</p>
            </div>
            <Button onClick={() => document.getElementById("checkout-cart")?.scrollIntoView({ behavior: "smooth" })}>
              <Receipt className="mr-2 h-4 w-4" />
              Review &amp; pay
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
