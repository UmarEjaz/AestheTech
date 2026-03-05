import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CheckoutForm } from "@/components/sales/checkout-form";
import { getClients } from "@/lib/actions/client";
import { getServices } from "@/lib/actions/service";
import { getActiveProducts } from "@/lib/actions/product";
import { getStaffForAppointments } from "@/lib/actions/appointment";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function NewSalePage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;

  if (!hasPermission(userRole, "sales:create")) {
    redirect("/dashboard/access-denied");
  }

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
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{clientsResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!servicesResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{servicesResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!staffResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{staffResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const settings = settingsResult.success ? settingsResult.data : {
    currencySymbol: "$",
    taxRate: 0,
    pointsPerDollar: 100,
    loyaltyProgramEnabled: true,
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
    category: service.category,
    points: service.points,
  }));

  // Transform products
  const products = productsResult.success ? productsResult.data : [];

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">New Sale</h1>
          <p className="text-muted-foreground">
            Create a new sale by selecting a client, services, and products
          </p>
        </div>

        <CheckoutForm
          clients={clientsWithLoyalty}
          services={services}
          products={products}
          staff={staffResult.data}
          currencySymbol={settings.currencySymbol}
          taxRate={settings.taxRate}
          pointsPerDollar={settings.pointsPerDollar}
          loyaltyProgramEnabled={settings.loyaltyProgramEnabled}
        />
      </div>
    </DashboardLayout>
  );
}
