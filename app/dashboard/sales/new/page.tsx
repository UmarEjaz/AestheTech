import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/sales/checkout-form";
import { getClients } from "@/lib/actions/client";
import { getServices } from "@/lib/actions/service";
import { getActiveProducts } from "@/lib/actions/product";
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

  // Fetch all required data in parallel
  const [clientsResult, servicesResult, productsResult, staffResult, settingsResult] = await Promise.all([
    getClients({ limit: 100 }),
    getServices({ isActive: true, limit: 100 }),
    getActiveProducts(),
    getStaffForAppointments(),
    getSettings(),
  ]);

  if (!clientsResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{clientsResult.error}</p>
        </div>
      </>
    );
  }

  if (!servicesResult.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{servicesResult.error}</p>
        </div>
      </>
    );
  }

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

  // Transform clients to include loyalty points
  const clientsWithLoyalty = clientsResult.data.clients.map((client) => ({
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    email: client.email,
    isWalkIn: client.isWalkIn,
    loyaltyPoints: client.loyaltyPoints,
  }));

  // Transform services
  const services = servicesResult.data.services.map((service) => ({
    id: service.id,
    name: service.name,
    price: Number(service.price),
    duration: service.duration,
    category: service.category?.name ?? null,
    points: service.points,
  }));

  // Transform products
  const products = productsResult.success ? productsResult.data : [];

  // If launched from an appointment ("Check out"), build the appointment context:
  // lock the client, seed the cart with the booked service, and carry the deposit.
  const { appointmentId } = await searchParams;
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
    client: (typeof clientsWithLoyalty)[number];
    depositPaid: number;
    staffId: string;
    seedItems: SeedItem[];
    scheduleLabel: string;
    bookedServices: BookedService[];
  };
  let appointmentContext: ApptCtx | undefined;

  if (appointmentId) {
    const apptResult = await getAppointment(appointmentId);
    if (apptResult.success && !apptResult.data.sale) {
      const appt = apptResult.data;
      const fullClient = clientsWithLoyalty.find((c) => c.id === appt.clientId) ?? {
        id: appt.client.id,
        firstName: appt.client.firstName,
        lastName: appt.client.lastName,
        phone: appt.client.phone,
        email: appt.client.email,
        isWalkIn: appt.client.isWalkIn,
        loyaltyPoints: null,
      };
      // Seed one cart item per booked service (each with its own staff + snapshot price).
      const seedItems: SeedItem[] = appt.services.map((line) => {
        const seedService = services.find((s) => s.id === line.service.id);
        return {
          id: `appt-${line.id}`,
          type: "service" as const,
          serviceId: line.service.id,
          name: seedService?.name ?? line.service.name,
          staffId: line.staff.id,
          staffName: `${line.staff.firstName} ${line.staff.lastName}`,
          price: Number(line.price),
          quantity: 1,
          points: seedService?.points ?? 0,
        };
      });
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
        name: services.find((s) => s.id === line.service.id)?.name ?? line.service.name,
        staffName: `${line.staff.firstName} ${line.staff.lastName}`,
        durationMin: services.find((s) => s.id === line.service.id)?.duration ?? 0,
        price: Number(line.price),
      }));
      appointmentContext = {
        appointmentId: appt.id,
        client: fullClient,
        depositPaid: appt.payments.reduce((s, p) => s + Number(p.amount), 0),
        staffId: appt.staffId,
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
          clients={clientsWithLoyalty}
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
