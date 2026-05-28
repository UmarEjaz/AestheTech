import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/categories/category-manager";
import { CategoryErrorState } from "@/components/categories/category-error-state";
import {
  getAllProductCategories,
  createProductCategory,
  updateProductCategory,
  toggleProductCategory,
  deleteProductCategory,
} from "@/lib/actions/product-category";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

export default async function ProductCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  const canView = isSuperAdmin || await hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, session.user.id);
  if (!canView) {
    redirectAccessDenied(["product-categories:view"]);
  }

  const canCreate = isSuperAdmin || await hasPermission(userRoleId, "product-categories:create", isSuperAdmin, salonId, session.user.id);
  const canUpdate = isSuperAdmin || await hasPermission(userRoleId, "product-categories:update", isSuperAdmin, salonId, session.user.id);
  const canDelete = isSuperAdmin || await hasPermission(userRoleId, "product-categories:delete", isSuperAdmin, salonId, session.user.id);

  const result = await getAllProductCategories();
  if (!result.success) {
    return (
      <DashboardLayout isSuperAdmin={isSuperAdmin}>
        <CategoryErrorState
          title="Product Categories"
          description="Manage product categories for your organization"
          backHref="/dashboard/products"
          backLabel="Back to products"
          error={result.error}
        />
      </DashboardLayout>
    );
  }
  const categories = result.data;

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/products" aria-label="Back to products">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Product Categories</h1>
            <p className="text-muted-foreground">
              Manage product categories for your organization
            </p>
          </div>
        </div>

        <CategoryManager
          title="Product Categories"
          countLabel="Products"
          categories={categories}
          onCreate={canCreate ? createProductCategory : undefined}
          onUpdate={canUpdate ? updateProductCategory : undefined}
          onToggle={canUpdate ? toggleProductCategory : undefined}
          onDelete={canDelete ? deleteProductCategory : undefined}
        />
      </div>
    </DashboardLayout>
  );
}
