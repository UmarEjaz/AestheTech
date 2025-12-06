"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod/dist/zod.js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { serviceSchema, ServiceFormData, ServiceFormInput } from "@/lib/validations/service";
import { createService, updateService } from "@/lib/actions/service";

interface ServiceFormProps {
  service?: {
    id: string;
    name: string;
    description: string | null;
    duration: number;
    price: number | string;
    points: number;
    category: string | null;
    isActive: boolean;
  };
  mode: "create" | "edit";
  categories: string[];
}

export function ServiceForm({ service, mode, categories }: ServiceFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ServiceFormInput, unknown, ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: service?.name || "",
      description: service?.description || "",
      duration: service?.duration || 30,
      price: service ? Number(service.price) : 0,
      points: service?.points || 0,
      category: service?.category || "",
      isActive: service?.isActive ?? true,
    },
  });

  const onSubmit = async (data: ServiceFormData) => {
    setIsSubmitting(true);

    try {
      if (mode === "create") {
        const result = await createService(data);
        if (result.success) {
          toast.success("Service created successfully");
          router.push("/dashboard/services");
        } else {
          toast.error(result.error);
        }
      } else if (service) {
        const result = await updateService({ id: service.id, ...data });
        if (result.success) {
          toast.success("Service updated successfully");
          router.push("/dashboard/services");
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
          <CardTitle>Service Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Service Name *</Label>
              <Input
                id="name"
                {...register("name")}
                placeholder="Haircut"
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
                placeholder="Hair"
                list="categories"
              />
              <datalist id="categories">
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
              placeholder="Describe the service..."
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing & Duration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes) *</Label>
              <Input
                id="duration"
                type="number"
                {...register("duration", { valueAsNumber: true })}
                placeholder="30"
                min="5"
                max="480"
              />
              {errors.duration && (
                <p className="text-sm text-destructive">{errors.duration.message}</p>
              )}
            </div>
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
          {mode === "create" ? "Create Service" : "Update Service"}
        </Button>
      </div>
    </form>
  );
}
