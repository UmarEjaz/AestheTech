"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { productSchema, ProductFormData, ProductFormInput } from "@/lib/validations/product";
import { createProduct, updateProduct } from "@/lib/actions/product";

interface ProductFormProps {
  product?: {
    id: string;
    name: string;
    description: string | null;
    sku: string | null;
    price: number | string;
    cost: number | string | null;
    stock: number;
    lowStockThreshold: number;
    points: number;
    category: string | null;
    isActive: boolean;
  };
  mode: "create" | "edit";
  categories: string[];
}

export function ProductForm({ product, mode, categories }: ProductFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormInput, unknown, ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || "",
      description: product?.description || "",
      sku: product?.sku || "",
      price: product ? Number(product.price) : 0,
      cost: product?.cost ? Number(product.cost) : undefined,
      stock: product?.stock ?? 0,
      lowStockThreshold: product?.lowStockThreshold ?? 5,
      points: product?.points || 0,
      category: product?.category || "",
      isActive: product?.isActive ?? true,
    },
  });

  const onSubmit = async (data: ProductFormData) => {
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createProduct(data);
        if (result.success) {
          toast.success("Product created successfully");
          router.push("/dashboard/products");
        } else {
          toast.error(result.error);
        }
      } else if (product) {
        const result = await updateProduct({ id: product.id, ...data });
        if (result.success) {
          toast.success("Product updated successfully");
          router.push("/dashboard/products");
        } else {
          toast.error(result.error);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Product Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Product Name *</Label>
              <Input
                id="name"
                {...register("name")}
                placeholder="Shampoo"
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                {...register("category")}
                placeholder="Hair Care"
                list="product-categories"
              />
              <datalist id="product-categories">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
              {errors.category && (
                <p className="text-sm text-destructive">{errors.category.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              {...register("description")}
              placeholder="Describe the product..."
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sku">SKU (Optional)</Label>
            <Input
              id="sku"
              {...register("sku")}
              placeholder="PROD-001"
            />
            {errors.sku && (
              <p className="text-sm text-destructive">{errors.sku.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing & Inventory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="price">Price ($) *</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                {...register("price", { valueAsNumber: true })}
                placeholder="0.00"
                min="0"
              />
              {errors.price && (
                <p className="text-sm text-destructive">{errors.price.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost">Cost ($)</Label>
              <Input
                id="cost"
                type="number"
                step="0.01"
                {...register("cost", { valueAsNumber: true })}
                placeholder="0.00"
                min="0"
              />
              {errors.cost && (
                <p className="text-sm text-destructive">{errors.cost.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="points">Loyalty Points</Label>
              <Input
                id="points"
                type="number"
                {...register("points", { valueAsNumber: true })}
                placeholder="0"
                min="0"
              />
              {errors.points && (
                <p className="text-sm text-destructive">{errors.points.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stock">Stock Quantity *</Label>
              <Input
                id="stock"
                type="number"
                {...register("stock", { valueAsNumber: true })}
                placeholder="0"
                min="0"
              />
              {errors.stock && (
                <p className="text-sm text-destructive">{errors.stock.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lowStockThreshold">Low Stock Threshold</Label>
              <Input
                id="lowStockThreshold"
                type="number"
                {...register("lowStockThreshold", { valueAsNumber: true })}
                placeholder="5"
                min="0"
              />
              {errors.lowStockThreshold && (
                <p className="text-sm text-destructive">{errors.lowStockThreshold.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create Product" : "Update Product"}
        </Button>
      </div>
    </form>
  );
}
