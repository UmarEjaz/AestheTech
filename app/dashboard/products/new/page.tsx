import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/products/product-form";
import { getActiveProductCategories } from "@/lib/actions/product-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function NewProductPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  if (!isSuperAdmin) {
    // Category dropdown is just form data — the category-fetch server action
    // guards itself, so don't require the category-management view permission here.
    // hasPermission applies :view inference, so :create implicitly grants :view —
    // no need to check :view explicitly.
    const canCreate = await hasPermission(userRoleId, "products:create", isSuperAdmin, salonId, session.user.id);
    if (!canCreate) {
      redirectAccessDenied(["products:create"]);
    }
  }

  const [categoriesResult, settingsResult] = await Promise.all([
    getActiveProductCategories(),
    getSettings(),
  ]);
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/products">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to products</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add New Product</h1>
            <p className="text-muted-foreground">
              Add a new retail product to your catalog
            </p>
          </div>
        </div>

        <ProductForm mode="create" categories={categories} currencyCode={currencyCode} />
      </div>
    </>
  );
}
