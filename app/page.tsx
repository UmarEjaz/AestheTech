import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <div className="text-center max-w-2xl">
        <div className="flex justify-center mb-6">
          <div className="h-20 w-20 rounded-full bg-primary flex items-center justify-center">
            <span className="text-4xl font-bold text-primary-foreground">A</span>
          </div>
        </div>
        <h1 className="text-5xl font-bold text-primary mb-4">AestheTech</h1>
        <p className="text-xl text-muted-foreground mb-8">
          A comprehensive salon management system designed to automate and
          streamline your salon operations.
        </p>
        <div className="flex gap-4 justify-center">
          {session ? (
            <Button size="lg" asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button size="lg" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">Get Started</Link>
              </Button>
            </>
          )}
        </div>
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <div className="text-3xl font-bold text-primary">500+</div>
            <div className="text-sm text-muted-foreground">Active Clients</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-primary">10k+</div>
            <div className="text-sm text-muted-foreground">Appointments</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-primary">50+</div>
            <div className="text-sm text-muted-foreground">Services</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-primary">99%</div>
            <div className="text-sm text-muted-foreground">Satisfaction</div>
          </div>
        </div>
      </div>
    </main>
  );
}
