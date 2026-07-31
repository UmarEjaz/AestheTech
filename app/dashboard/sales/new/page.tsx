import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/sales/checkout-form";
import { getActiveProducts } from "@/lib/actions/product";
import { getActiveServices } from "@/lib/actions/service";
import { getStaffForAppointments, getAppointment } from "@/lib/actions/appointment";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ appointmentId?: string }>;
}) {
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
  await requireModule("sales");
  const permUserId = actor.userId;
  if (!(await hasPermission(userRoleId, "sales:create", isSuperAdmin, salonId, permUserId))) {
    redirectAccessDenied(["sales:create"]);
  }
  const canDiscount = await hasPermission(userRoleId, "sales:discount", isSuperAdmin, salonId, permUserId);

  // Fetch data in parallel. The client picker searches the DB on demand (server-side), so we no
  // longer load a capped client list here. Services are a bounded menu (like products), so we load
  // them all and let the picker filter in the browser.
  const [servicesResult, productsResult, staffResult, settingsResult] = await Promise.all([
    getActiveServices(),
    getActiveProducts(),
    getStaffForAppointments(),
    getSettings(),
  ]);

  if (!staffResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{staffResult.error}</p>
        </div>
      </>
    );
  }

  const settings = settingsResult.success ? settingsResult.data : {
    currencyCode: "USD",
    taxRate: 0,
    pointsPerDollar: 100,
    loyaltyProgramEnabled: true,
    allowPartialPayment: false,
    allowPayLater: false,
    timezone: "UTC",
  };



  const services = servicesResult.success ? servicesResult.data : [];
  const products = productsResult.success ? productsResult.data : [];

  // If launched from an appointment ("Check out"), build the appointment context:
  // lock the client, seed the cart with the booked service, and carry the deposit.
  const parsedParams = z
    .object({ appointmentId: z.string().min(1).optional() })
    .safeParse(await searchParams);
  const appointmentId = parsedParams.success ? parsedParams.data.appointmentId : undefined;
  type SeedItem = {
    id: string;
    type: "service";
    serviceId: string;
    name: string;
    staffId: string;
    staffName: string;
    price: number;
    quantity: number;
    points: number;
  };
  type BookedService = {
    name: string;
    staffName: string;
    durationMin: number;
    price: number;
  };
  type ApptCtx = {
    appointmentId: string;
    client: {
      id: string;
      firstName: string;
      lastName: string | null;
      phone: string | null;
      email: string | null;
      isWalkIn: boolean;
      loyaltyPoints: { balance: number; tier: string } | null;
    };
    depositPaid: number;
    staffId: string;
    seedItems: SeedItem[];
    scheduleLabel: string;
    bookedServices: BookedService[];
  };
  let appointmentContext: ApptCtx | undefined;

  if (appointmentId) {
    const apptResult = await getAppointment(appointmentId);
    // Don't silently fall back to a blank sale: surface a load error, and if the appointment
    // was already checked out, send the user to its existing sale instead of a duplicate.
    if (!apptResult.success) {
      return (
        <>
          <div className="text-center py-12">
            <p className="text-destructive">{apptResult.error}</p>
          </div>
        </>
      );
    }
    if (apptResult.data.sale) {
      redirect(`/dashboard/sales/${apptResult.data.sale.id}`);
    }
    {
      const appt = apptResult.data;
      // Authoritative: the appointment fetch now carries the client's loyalty and each service's
      // points/duration, so we never look them up in a capped 100-item list (fixes wrong data for
      // clients/services beyond #100).
      const fullClient = {
        id: appt.client.id,
        firstName: appt.client.firstName,
        lastName: appt.client.lastName,
        phone: appt.client.phone,
        email: appt.client.email,
        isWalkIn: appt.client.isWalkIn,
        loyaltyPoints: appt.client.loyaltyPoints,
      };
      // Seed one cart item per booked service (each with its own staff + snapshot price).
      const seedItems: SeedItem[] = appt.services.map((line) => ({
        id: `appt-${line.id}`,
        type: "service" as const,
        serviceId: line.service.id,
        name: line.service.name,
        staffId: line.staff.id,
        staffName: `${line.staff.firstName} ${line.staff.lastName}`,
        price: Number(line.price),
        quantity: 1,
        points: line.service.points,
      }));
      // Preformat the booked schedule in the salon timezone (server-side) so the
      // checkout page can show a compact appointment summary without timezone plumbing.
      const tz = settings.timezone || "UTC";
      const dateStr = new Intl.DateTimeFormat("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz,
      }).format(appt.startTime);
      const timeFmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: tz,
      });
      const scheduleLabel = `${dateStr} · ${timeFmt.format(appt.startTime)} – ${timeFmt.format(appt.endTime)}`;
      const bookedServices: BookedService[] = appt.services.map((line) => ({
        name: line.service.name,
        staffName: `${line.staff.firstName} ${line.staff.lastName}`,
        durationMin: line.duration,
        price: Number(line.price),
      }));
      appointmentContext = {
        appointmentId: appt.id,
        client: fullClient,
        depositPaid: appt.payments.reduce((s, p) => s + Number(p.amount), 0),
        // Primary provider = the first booked service's staff (default for the checkout picker).
        staffId: appt.services[0].staff.id,
        seedItems,
        scheduleLabel,
        bookedServices,
      };
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{appointmentContext ? "Check Out Appointment" : "New Sale"}</h1>
          <p className="text-muted-foreground">
            {appointmentContext
              ? "Review the booked service, add any extras, and take payment."
              : "Create a new sale by selecting a client, services, and products"}
          </p>
        </div>

        <CheckoutForm
          services={services}
          products={products}
          staff={staffResult.data}
          currencyCode={settings.currencyCode}
          taxRate={settings.taxRate}
          pointsPerDollar={settings.pointsPerDollar}
          loyaltyProgramEnabled={settings.loyaltyProgramEnabled}
          allowPartialPayment={settings.allowPartialPayment}
          allowPayLater={settings.allowPayLater}
          appointmentContext={appointmentContext}
          canDiscount={canDiscount}
        />
      </div>
    </>
  );
}
