import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CategoryErrorStateProps {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  error: string;
}

export function CategoryErrorState({
  title,
  description,
  backHref,
  backLabel,
  error,
}: CategoryErrorStateProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref} aria-label={backLabel}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="rounded-md border p-4 text-sm text-destructive">
        {error}
      </div>
    </div>
  );
}
