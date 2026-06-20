import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PERMISSION_REGISTRY, MODULE_LABELS } from "@/lib/permissions-defaults";

const PERMISSION_LABEL_MAP = new Map(
  PERMISSION_REGISTRY.map((p) => [p.code, p.label])
);

function formatPermissionCode(code: string): string {
  const fromRegistry = PERMISSION_LABEL_MAP.get(code);
  if (fromRegistry) return fromRegistry;

  // Fallback for codes not yet in the registry
  const [module, action] = code.split(":");
  const moduleName = MODULE_LABELS[module] || module.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const actionName = action ? action.charAt(0).toUpperCase() + action.slice(1) : "";
  return `${actionName} ${moduleName}`.trim();
}

interface PageProps {
  searchParams: Promise<{ r?: string; m?: string }>;
}

export default async function AccessDeniedPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  let missingPermissions: string[] = [];

  if (params.r) {
    try {
      const decoded = Buffer.from(params.r, "base64url").toString();
      missingPermissions = decoded.split(",").filter(Boolean);
    } catch {
      // Invalid encoding — show generic message
    }
  }

  // Optional contextual reason (e.g. role-hierarchy denial) — shown instead of
  // the generic line. Not a missing permission, so no "Missing permissions" list.
  let reason: string | null = null;
  if (params.m) {
    try {
      reason = Buffer.from(params.m, "base64url").toString() || null;
    } catch {
      // Invalid encoding — fall back to generic message
    }
  }

  return (
    <>
      <div className="flex min-h-[400px] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {reason ?? "You don't have permission to access this page."}
            </p>
            {missingPermissions.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Missing permissions:</p>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {missingPermissions.map((code) => (
                    <li key={code}>
                      {formatPermissionCode(code)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Contact your administrator if you believe this is an error.
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
