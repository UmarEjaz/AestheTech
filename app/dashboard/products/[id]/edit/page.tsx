import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/products/product-form";
import { getProduct } from "@/lib/actions/product";
import { getAllProductCategories } from "@/lib/actions/product-category";
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
    // Category dropdown is just form data — the category-fetch server action
    // guards itself, so don't require the category-management view permission here.
    // hasPermission applies :view inference, so :update implicitly grants :view —
    // no need to check :view explicitly.
    const canUpdate = await hasPermission(userRoleId, "products:update", isSuperAdmin, salonId, session.user.id);
    if (!canUpdate) {
      redirectAccessDenied(["products:update"]);
    }
  }

  const [productResult, categoriesResult, settingsResult] = await Promise.all([
    getProduct(id),
    getAllProductCategories(),
    getSettings(),
  ]);

  if (!productResult.success || !productResult.data) {
    notFound();
  }

  const product = productResult.data;
  // Pass id/name/isActive so the form can pin the product's current category at the top
  // and hide other inactive ones. See ProductForm for the dropdown rendering rule.
  const categories = categoriesResult.success
    ? categoriesResult.data.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))
    : [];
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
    </>
  );
}
