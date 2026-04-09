import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ProductSearch } from "@/components/products/product-search";
import { ProductList } from "@/components/products/product-list";
import { getProducts } from "@/lib/actions/product";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

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
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;

  if (!await hasPermission(userRole, "products:view", isSuperAdmin, salonId, session.user.id)) {
    redirect("/dashboard/access-denied");
  }

  const canManage = await hasPermission(userRole, "products:manage", isSuperAdmin, salonId, session.user.id);

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
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { products, total, totalPages, categories } = result.data;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Products</h1>
            <p className="text-muted-foreground">
              Manage your salon&apos;s retail products
            </p>
          </div>
          {canManage && (
            <Button asChild>
              <Link href="/dashboard/products/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Link>
            </Button>
          )}
        </div>

        {/* Search and Filters */}
        <ProductSearch categories={categories} />

        {/* Product List */}
        <ProductList
          products={products}
          page={page}
          totalPages={totalPages}
          total={total}
          canManage={canManage}
          currencyCode={currencyCode}
        />
      </div>
    </DashboardLayout>
  );
}
