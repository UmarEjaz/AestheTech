import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TOGGLEABLE_MODULES, isToggleableModuleKey } from "@/lib/modules";

interface PageProps {
  searchParams: Promise<{ m?: string }>;
}

export default async function ModuleUnavailablePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const moduleLabel =
    params.m && isToggleableModuleKey(params.m)
      ? TOGGLEABLE_MODULES.find((mod) => mod.key === params.m)?.label
      : undefined;

  return (
    <>
      <div className="flex min-h-[400px] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageX className="h-5 w-5 text-muted-foreground" />
              Feature unavailable
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {moduleLabel ? (
                <>
                  The <span className="font-medium text-foreground">{moduleLabel}</span> feature is
                  not enabled for this salon.
                </>
              ) : (
                <>This feature is not enabled for this salon.</>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              Contact your administrator if you believe it should be available.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
