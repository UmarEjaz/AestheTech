import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getService } from "@/lib/actions/service";
import { getActiveServiceCategories } from "@/lib/actions/service-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditServicePage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  if (!isSuperAdmin) {
    const [canView, canUpdate, canViewCategories] = await Promise.all([
      hasPermission(userRoleId, "services:view", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "services:update", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "service-categories:view", isSuperAdmin, salonId, session.user.id),
    ]);

    if (!canView || !canUpdate || !canViewCategories) {
      const missing: string[] = [];
      if (!canView) missing.push("services:view");
      if (!canUpdate) missing.push("services:update");
      if (!canViewCategories) missing.push("service-categories:view");
      redirectAccessDenied(missing);
    }
  }

  const [serviceResult, categoriesResult, settingsResult] = await Promise.all([
    getService(id),
    getActiveServiceCategories(),
    getSettings(),
  ]);

  if (!serviceResult.success || !serviceResult.data) {
    notFound();
  }

  const service = serviceResult.data;
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/services">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to services</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Service</h1>
            <p className="text-muted-foreground">
              Update {service.name}
            </p>
          </div>
        </div>

        <ServiceForm
          mode="edit"
          service={{
            id: service.id,
            name: service.name,
            description: service.description,
            duration: service.duration,
            price: Number(service.price),
            cost: service.cost ? Number(service.cost) : null,
            points: service.points,
            categoryId: service.categoryId,
            isActive: service.isActive,
          }}
          categories={categories}
          currencyCode={currencyCode}
        />
      </div>
    </DashboardLayout>
  );
}
