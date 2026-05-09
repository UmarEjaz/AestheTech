import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/categories/category-manager";
import {
  getProductCategories,
  createProductCategory,
  updateProductCategory,
  toggleProductCategory,
} from "@/lib/actions/product-category";
import { hasPermission } from "@/lib/permissions";

export default async function ProductCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  const canManage = isSuperAdmin || await hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, session.user.id);

  if (!canManage) {
    redirect("/dashboard/access-denied");
  }

  const result = await getProductCategories();
  const categories = result.success ? result.data : [];

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
          onCreate={createProductCategory}
          onUpdate={updateProductCategory}
          onToggle={toggleProductCategory}
        />
      </div>
    </DashboardLayout>
  );
}
