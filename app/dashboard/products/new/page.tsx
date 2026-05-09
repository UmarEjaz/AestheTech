import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/products/product-form";
import { getAllProductCategories } from "@/lib/actions/product";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function NewProductPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.salonRole;
  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  if (!isSuperAdmin) {
    const [canView, canCreate, canViewCategories] = await Promise.all([
      hasPermission(userRoleId, "products:view", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "products:create", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, session.user.id),
    ]);

    if (!canView || !canCreate || !canViewCategories) {
      redirect("/dashboard/access-denied");
    }
  }

  const [categoriesResult, settingsResult] = await Promise.all([
    getAllProductCategories(),
    getSettings(),
  ]);
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/products">
              <ArrowLeft className="h-4 w-4" />
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
    </DashboardLayout>
  );
}
