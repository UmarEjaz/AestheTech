"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Menu, Bell, ChevronDown, LogOut, User, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { MobileSidebar } from "@/components/layout/sidebar";
import { SalonSwitcher } from "@/components/layout/salon-switcher";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { useRoleLabel } from "@/lib/roles-context";
import { cn } from "@/lib/utils";

interface HeaderProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function Header({ sidebarCollapsed = false, onToggleSidebar }: HeaderProps) {
  const { data: session } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const userInitials = session?.user
    ? `${session.user.firstName?.[0] || ""}${session.user.lastName?.[0] || ""}`
    : "U";

  const userRole = session?.user?.salonRole || null;
  // Real platform identity — a super admin is shown as such (and uses the
  // impersonation flow) even while acting as a tenant user.
  const isSuperAdmin = session?.user?.isPlatformAdmin || false;
  const roleDisplayLabel = useRoleLabel(userRole ?? "");

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-64",
        "md:left-64",
        sidebarCollapsed && "md:left-16"
      )}
    >
      {/* Mobile menu trigger */}
      <div className="flex items-center gap-4">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                  <span className="text-lg font-bold text-primary-foreground">A</span>
                </div>
                <span className="text-xl font-bold text-primary">AestheTech</span>
              </SheetTitle>
            </SheetHeader>
            <MobileSidebar isSuperAdmin={isSuperAdmin} />
          </SheetContent>
        </Sheet>

        {/* Desktop sidebar toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex h-9 w-9"
          onClick={onToggleSidebar}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
      </div>

      {/* Active impersonation indicator — centered over the whole viewport
          (fixed to the screen, not the header which starts at the sidebar edge).
          Vertically centered on the 64px-tall header. Only renders while impersonating. */}
      <div className="pointer-events-none fixed left-1/2 top-8 z-40 -translate-x-1/2 -translate-y-1/2 [&>*]:pointer-events-auto">
        <ImpersonationBanner />
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Owner/member salon switcher — super admins use the impersonation flow instead */}
        {!isSuperAdmin && <SalonSwitcher />}
        <ThemeToggle />

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="h-9 w-9 relative">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                {session?.user?.name ? (
                  <span className="text-sm font-medium">{session.user.name}</span>
                ) : session?.user?.email ? (
                  <span className="text-sm font-medium">{session.user.email}</span>
                ) : null}
                {isSuperAdmin ? (
                  <span className="text-xs text-muted-foreground capitalize">
                    super admin
                  </span>
                ) : roleDisplayLabel ? (
                  <span className="text-xs text-muted-foreground">
                    {roleDisplayLabel}
                  </span>
                ) : null}
              </div>
              <ChevronDown className="h-4 w-4 hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {session?.user?.name}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {session?.user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
