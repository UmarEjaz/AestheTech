import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { Plus, FolderOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProductSearch } from "@/components/products/product-search";
import { ProductList } from "@/components/products/product-list";
import { getProducts } from "@/lib/actions/product";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    lowStock?: string;
    page?: string;
  }>;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirectAccessDenied();
  }
  const actor = getEffectiveActor(session.user);
  const userRoleId = actor.roleId;
  const isSuperAdmin = actor.isSuperAdmin;
  const salonId = actor.salonId;

  await requireModule("products");
  const permUserId = actor.userId;
  if (!await hasPermission(userRoleId, "products:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["products:view"]);
  }

  const [canCreate, canUpdate, canDelete, canViewCategories] = await Promise.all([
    hasPermission(userRoleId, "products:create", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "products:update", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "products:delete", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "product-categories:view", isSuperAdmin, salonId, permUserId),
  ]);

  const page = parseInt(params.page || "1", 10);
  const query = params.q || "";
  const category = params.category || "";
  const lowStock = params.lowStock === "true";

  const [result, settingsResult] = await Promise.all([
    getProducts({ query, category, lowStock, page, limit: 12 }),
    getSettings(),
  ]);
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

  if (!result.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </>
    );
  }

  const { products, total, totalPages, categories } = result.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Products</h1>
            <p className="text-muted-foreground">
              Manage your salon&apos;s retail products
            </p>
          </div>
          <div className="flex gap-2">
            {canViewCategories && (
              <Button variant="outline" asChild>
                <Link href="/dashboard/products/categories">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Categories
                </Link>
              </Button>
            )}
            {canCreate && (
              <Button asChild>
                <Link href="/dashboard/products/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <ProductSearch categories={categories} />

        {/* Product List */}
        <ProductList
          products={products}
          page={page}
          totalPages={totalPages}
          total={total}
          canUpdate={canUpdate}
          canDelete={canDelete}
          currencyCode={currencyCode}
        />
      </div>
    </>
  );
}
