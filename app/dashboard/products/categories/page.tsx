import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
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
import { requireModule } from "@/lib/require-module";

export default async function ProductCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;
  await requireModule("products");

  // hasPermission already short-circuits on isSuperAdmin internally (third arg) —
  // the outer `isSuperAdmin || ` was duplicated logic.
  const permUserId = actor.userId;
  const canView = await hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, permUserId);
  if (!canView) {
    redirectAccessDenied(["product-categories:view"]);
  }

  const canCreate = await hasPermission(userRoleId, "product-categories:create", isSuperAdmin, salonId, permUserId);
  const canUpdate = await hasPermission(userRoleId, "product-categories:update", isSuperAdmin, salonId, permUserId);
  const canDelete = await hasPermission(userRoleId, "product-categories:delete", isSuperAdmin, salonId, permUserId);

  const result = await getAllProductCategories();
  if (!result.success) {
    return (
      <>
        <CategoryErrorState
          title="Product Categories"
          description="Manage product categories for your organization"
          backHref="/dashboard/products"
          backLabel="Back to products"
          error={result.error}
        />
      </>
    );
  }
  const categories = result.data;

  return (
    <>
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
    </>
  );
}
