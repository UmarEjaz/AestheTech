import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/products/product-form";
import { getProduct } from "@/lib/actions/product";
import { getActiveProductCategories } from "@/lib/actions/product-category";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
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
      hasPermission(userRoleId, "products:view", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "products:update", isSuperAdmin, salonId, session.user.id),
      hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, session.user.id),
    ]);

    if (!canView || !canUpdate || !canViewCategories) {
      const missing: string[] = [];
      if (!canView) missing.push("products:view");
      if (!canUpdate) missing.push("products:update");
      if (!canViewCategories) missing.push("product-categories:view");
      redirectAccessDenied(missing);
    }
  }

  const [productResult, categoriesResult, settingsResult] = await Promise.all([
    getProduct(id),
    getActiveProductCategories(),
    getSettings(),
  ]);

  if (!productResult.success || !productResult.data) {
    notFound();
  }

  const product = productResult.data;
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  return (
    <DashboardLayout isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/products">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to products</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Product</h1>
            <p className="text-muted-foreground">
              Update {product.name}
            </p>
          </div>
        </div>

        <ProductForm
          mode="edit"
          product={{
            id: product.id,
            name: product.name,
            description: product.description,
            sku: product.sku,
            price: Number(product.price),
            cost: product.cost ? Number(product.cost) : null,
            stock: product.stock,
            lowStockThreshold: product.lowStockThreshold,
            points: product.points,
            categoryId: product.categoryId,
            isActive: product.isActive,
          }}
          categories={categories}
          currencyCode={currencyCode}
        />
      </div>
    </DashboardLayout>
  );
}
