import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/categories/category-manager";
import {
  getAllServiceCategories,
  createServiceCategory,
  updateServiceCategory,
  toggleServiceCategory,
  deleteServiceCategory,
} from "@/lib/actions/service-category";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

export default async function ServiceCategoriesPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const userRoleId = session.user.salonRoleId ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const salonId = session.user.salonId;
  await requireModule("services");

  const canView = isSuperAdmin || await hasPermission(userRoleId, "service-categories:view", isSuperAdmin, salonId, session.user.id);
  if (!canView) {
    redirectAccessDenied(["service-categories:view"]);
  }

  const canCreate = isSuperAdmin || await hasPermission(userRoleId, "service-categories:create", isSuperAdmin, salonId, session.user.id);
  const canUpdate = isSuperAdmin || await hasPermission(userRoleId, "service-categories:update", isSuperAdmin, salonId, session.user.id);
  const canDelete = isSuperAdmin || await hasPermission(userRoleId, "service-categories:delete", isSuperAdmin, salonId, session.user.id);

  const result = await getAllServiceCategories();
  const categories = result.success ? result.data : [];

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/services" aria-label="Back to services">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Service Categories</h1>
            <p className="text-muted-foreground">
              Manage service categories for your organization
            </p>
          </div>
        </div>

        <CategoryManager
          title="Service Categories"
          countLabel="Services"
          categories={categories}
          onCreate={canCreate ? createServiceCategory : undefined}
          onUpdate={canUpdate ? updateServiceCategory : undefined}
          onToggle={canUpdate ? toggleServiceCategory : undefined}
          onDelete={canDelete ? deleteServiceCategory : undefined}
        />
      </div>
    </>
  );
}
