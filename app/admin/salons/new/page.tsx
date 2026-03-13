import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateSalonForm } from "./create-salon-form";

export default async function NewSalonPage() {
  const session = await auth();

  if (!session?.user?.isSuperAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl p-4 md:p-8">
        {/* Back nav + header */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href="/admin/salons">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Salons
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">Create New Salon</h1>
          <p className="text-muted-foreground mt-1">
            Set up a new salon on the platform
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Salon Details</CardTitle>
            <CardDescription>
              Fill in the basic information for the new salon. You can update
              these details later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateSalonForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
