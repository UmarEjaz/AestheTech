import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ServiceSearch } from "@/components/services/service-search";
import { ServiceList } from "@/components/services/service-list";
import { getServices } from "@/lib/actions/service";
import { hasPermission } from "@/lib/permissions";

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
  const userRole = session.user.role as Role;
  const canManage = hasPermission(userRole, "services:manage");

  const page = parseInt(params.page || "1", 10);
  const query = params.q || "";
  const category = params.category || "";

  const result = await getServices({ query, category, page, limit: 12 });

  if (!result.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{result.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  const { services, total, totalPages, categories } = result.data;

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Services</h1>
            <p className="text-muted-foreground">
              Manage your salon&apos;s service offerings
            </p>
          </div>
          {canManage && (
            <Button asChild>
              <Link href="/dashboard/services/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Service
              </Link>
            </Button>
          )}
        </div>

        {/* Search and Filters */}
        <ServiceSearch categories={categories} />

        {/* Service List */}
        <ServiceList
          services={services}
          page={page}
          totalPages={totalPages}
          total={total}
          canManage={canManage}
        />
      </div>
    </DashboardLayout>
  );
}
