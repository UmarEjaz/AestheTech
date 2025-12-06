import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getService, getAllCategories } from "@/lib/actions/service";
import { hasPermission } from "@/lib/permissions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditServicePage({ params }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "services:manage");

  if (!canManage) {
    redirect("/dashboard/services");
  }

  const [serviceResult, categoriesResult] = await Promise.all([
    getService(id),
    getAllCategories(),
  ]);

  if (!serviceResult.success || !serviceResult.data) {
    notFound();
  }

  const service = serviceResult.data;
  const categories = categoriesResult.success ? categoriesResult.data : [];

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/services">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Service</h1>
            <p className="text-muted-foreground">
              Update {service.name}
            </p>
          </div>
        </div>

        <ServiceForm
          mode="edit"
          service={{
            id: service.id,
            name: service.name,
            description: service.description,
            duration: service.duration,
            price: Number(service.price),
            points: service.points,
            category: service.category,
            isActive: service.isActive,
          }}
          categories={categories}
        />
      </div>
    </DashboardLayout>
  );
}
