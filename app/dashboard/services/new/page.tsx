import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getActiveServiceCategories } from "@/lib/actions/service-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function NewServicePage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  await requireModule("services");
  if (!isSuperAdmin) {
    // Category dropdown is just form data — the category-fetch server action
    // guards itself, so don't require the category-management view permission here.
    // hasPermission applies :view inference, so :create implicitly grants :view —
    // no need to check :view explicitly.
    const canCreate = await hasPermission(userRoleId, "services:create", isSuperAdmin, salonId, session.user.id);
    if (!canCreate) {
      redirectAccessDenied(["services:create"]);
    }
  }

  const [categoriesResult, settingsResult] = await Promise.all([
    getActiveServiceCategories(),
    getSettings(),
  ]);
  const categories = categoriesResult.success ? categoriesResult.data : [];
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
            <h1 className="text-3xl font-bold">Add New Service</h1>
            <p className="text-muted-foreground">
              Create a new service offering
            </p>
          </div>
        </div>

        <ServiceForm mode="create" categories={categories} currencyCode={currencyCode} />
      </div>
    </>
  );
}
