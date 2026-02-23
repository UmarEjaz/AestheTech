import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/products/product-form";
import { getProduct, getAllProductCategories } from "@/lib/actions/product";
import { hasPermission } from "@/lib/permissions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "products:manage");

  if (!canManage) {
    redirect("/dashboard/access-denied");
  }

  const [productResult, categoriesResult] = await Promise.all([
    getProduct(id),
    getAllProductCategories(),
  ]);

  if (!productResult.success || !productResult.data) {
    notFound();
  }

  const product = productResult.data;
  const categories = categoriesResult.success ? categoriesResult.data : [];

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/products">
              <ArrowLeft className="h-4 w-4" />
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
            category: product.category,
            isActive: product.isActive,
          }}
          categories={categories}
        />
      </div>
    </DashboardLayout>
  );
}
