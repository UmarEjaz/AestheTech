import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/clients/client-form";
import { hasPermission } from "@/lib/permissions";

export default async function NewClientPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = (session.user.salonRole ?? null) as Role | null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const canCreate = hasPermission(userRole, "clients:create", isSuperAdmin);

  if (!canCreate) {
    redirect("/dashboard/access-denied");
  }

  return (
    <DashboardLayout userRole={userRole}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/clients">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Add New Client</h1>
            <p className="text-muted-foreground">
              Create a new client profile
            </p>
          </div>
        </div>

        <ClientForm mode="create" />
      </div>
    </DashboardLayout>
  );
}
