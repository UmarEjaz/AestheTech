import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSalons } from "@/lib/actions/salon";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SalonAdminTable } from "@/components/admin/salon-admin-table";

export default async function AdminSalonsPage() {
  const session = await auth();

  if (!session?.user?.isPlatformAdmin) {
    redirect("/dashboard");
  }

  const PAGE_SIZE = 20;
  const result = await getSalons({ page: 1, limit: PAGE_SIZE });

  return (
    <div className="container mx-auto max-w-6xl p-4 md:p-8">
        {/* Back nav + header */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Salon Management</h1>
              <p className="text-muted-foreground mt-1">
                View and manage all salons on the platform
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/salons/new">
                <Plus className="h-4 w-4 mr-2" />
                Create Salon
              </Link>
            </Button>
          </div>
        </div>

        {/* Content */}
        {!result.success ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{result.error}</p>
            </CardContent>
          </Card>
        ) : result.data.total === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No salons have been created yet.
              </p>
              <Button asChild className="mt-4">
                <Link href="/admin/salons/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first salon
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>All Salons</CardTitle>
            </CardHeader>
            <CardContent>
              <SalonAdminTable
                initialSalons={result.data.salons}
                initialTotal={result.data.total}
                initialPage={result.data.page}
                initialTotalPages={result.data.totalPages}
                pageSize={PAGE_SIZE}
              />
            </CardContent>
          </Card>
        )}
    </div>
  );
}
