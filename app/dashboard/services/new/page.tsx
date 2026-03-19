import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ServiceForm } from "@/components/services/service-form";
import { getAllCategories } from "@/lib/actions/service";
import { getSettings } from "@/lib/actions/settings";
import { hasPermission } from "@/lib/permissions";

export default async function NewServicePage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole as Role;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const canManage = hasPermission(userRole, "services:manage", isSuperAdmin);

  if (!canManage) {
    redirect("/dashboard/access-denied");
  }

  const [categoriesResult, settingsResult] = await Promise.all([
    getAllCategories(),
    getSettings(),
  ]);
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const currencyCode = settingsResult.success ? settingsResult.data.currencyCode : "USD";

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

        <ServiceForm mode="create" categories={categories} currencyCode={currencyCode} />
      </div>
    </DashboardLayout>
  );
}
