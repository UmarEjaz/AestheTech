import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getAllCategories } from "@/lib/actions/service";
import { hasPermission } from "@/lib/permissions";

export default async function NewServicePage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "services:manage");

  if (!canManage) {
    redirect("/dashboard/services");
  }

  const categoriesResult = await getAllCategories();
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
            <h1 className="text-3xl font-bold">Add New Service</h1>
            <p className="text-muted-foreground">
              Create a new service offering
            </p>
          </div>
        </div>

        <ServiceForm mode="create" categories={categories} />
      </div>
    </DashboardLayout>
  );
}
