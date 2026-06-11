import { auth } from "@/lib/auth";
import { getEffectiveActor } from "@/lib/effective-actor";
import { redirect } from "next/navigation";
import { Plus, FolderOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ServiceSearch } from "@/components/services/service-search";
import { ServiceList } from "@/components/services/service-list";
import { getServices } from "@/lib/actions/service";
import { hasPermission } from "@/lib/permissions";
import { redirectAccessDenied } from "@/lib/redirect-access-denied";
import { requireModule } from "@/lib/require-module";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    page?: string;
  }>;
}

export default async function ServicesPage({ searchParams }: PageProps) {
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
  await requireModule("services");
  const permUserId = actor.userId;
  if (!await hasPermission(userRoleId, "services:view", isSuperAdmin, salonId, permUserId)) {
    redirectAccessDenied(["services:view"]);
  }
  const [canCreate, canUpdate, canDelete, canViewCategories] = await Promise.all([
    hasPermission(userRoleId, "services:create", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "services:update", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "services:delete", isSuperAdmin, salonId, permUserId),
    hasPermission(userRoleId, "service-categories:view", isSuperAdmin, salonId, permUserId),
  ]);

  const page = parseInt(params.page || "1", 10);
  const query = params.q || "";
  const category = params.category || "";

  const result = await getServices({ query, category, page, limit: 12 });

  if (!result.success) {
    return (
      <>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </>
    );
  }

  const { services, total, totalPages, categories } = result.data;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Services</h1>
            <p className="text-muted-foreground">
              Manage your salon&apos;s service offerings
            </p>
          </div>
          <div className="flex gap-2">
            {canViewCategories && (
              <Button variant="outline" asChild>
                <Link href="/dashboard/services/categories">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Categories
                </Link>
              </Button>
            )}
            {canCreate && (
              <Button asChild>
                <Link href="/dashboard/services/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Service
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <ServiceSearch categories={categories} />

        {/* Service List */}
        <ServiceList
          services={services}
          page={page}
          totalPages={totalPages}
          total={total}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      </div>
    </>
  );
}
