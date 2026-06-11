import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getService } from "@/lib/actions/service";
import { getAllServiceCategories } from "@/lib/actions/service-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

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
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("services");
  if (!isSuperAdmin) {
    // Category dropdown is just form data — the category-fetch server action
    // guards itself, so don't require the category-management view permission here.
    // hasPermission applies :view inference, so :update implicitly grants :view —
    // no need to check :view explicitly.
    const permUserId = actor.userId;
    const canUpdate = await hasPermission(userRoleId, "services:update", isSuperAdmin, salonId, permUserId);
    if (!canUpdate) {
      redirectAccessDenied(["services:update"]);
    }
  }

  const [serviceResult, categoriesResult, settingsResult] = await Promise.all([
    getService(id),
    getAllServiceCategories(),
    getSettings(),
  ]);

  if (!serviceResult.success || !serviceResult.data) {
    notFound();
  }

  const service = serviceResult.data;
  // Pass id/name/isActive so the form can pin the service's current category at the top
  // and hide other inactive ones. See ServiceForm for the dropdown rendering rule.
  const categories = categoriesResult.success
    ? categoriesResult.data.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))
    : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <>
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
    </>
  );
}
