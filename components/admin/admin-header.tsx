"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { ChevronDown, LogOut, Building2, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Top bar for the Super Admin control plane (/admin). Provides platform nav and,
 * importantly, a Sign out action — the dashboard header isn't rendered here.
 */
export function AdminHeader() {
  const { data: session } = useSession();
  const user = session?.user;
  const initials = user
    ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` || "SA"
    : "SA";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
      <Link href="/admin" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
          <span className="text-lg font-bold text-primary-foreground">A</span>
        </div>
        <span className="text-xl font-bold text-primary">AestheTech</span>
        <span className="ml-2 hidden rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 sm:inline">
          Platform Admin
        </span>
      </Link>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
          <Link href="/admin">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Overview
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
          <Link href="/admin/salons">
            <Building2 className="mr-2 h-4 w-4" />
            Salons
          </Link>
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start md:flex">
                <span className="text-sm font-medium">{user?.name || user?.email}</span>
                <span className="text-xs text-muted-foreground">Super Admin</span>
              </div>
              <ChevronDown className="hidden h-4 w-4 md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="sm:hidden" asChild>
              <Link href="/admin/salons">
                <Building2 className="mr-2 h-4 w-4" />
                Salons
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
