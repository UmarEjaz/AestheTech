"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Role } from "@prisma/client";
import {
  Calendar,
  Users,
  UserCog,
  Scissors,
  Package,
  DollarSign,
  FileText,
  Clock,
  BarChart3,
  Settings,
  Gift,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles: Role[];
}

const navItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Appointments",
    href: "/dashboard/appointments",
    icon: Calendar,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Clients",
    href: "/dashboard/clients",
    icon: Users,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Services",
    href: "/dashboard/services",
    icon: Scissors,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Products",
    href: "/dashboard/products",
    icon: Package,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Sales",
    href: "/dashboard/sales",
    icon: DollarSign,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Invoices",
    href: "/dashboard/invoices",
    icon: FileText,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Schedules",
    href: "/dashboard/schedules",
    icon: Clock,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.STAFF, Role.RECEPTIONIST],
  },
  {
    title: "Staff",
    href: "/dashboard/staff",
    icon: UserCog,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  },
  {
    title: "Reports",
    href: "/dashboard/reports",
    icon: BarChart3,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  },
  {
    title: "Loyalty",
    href: "/dashboard/loyalty",
    icon: Gift,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN, Role.RECEPTIONIST],
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    roles: [Role.SUPER_ADMIN, Role.OWNER, Role.ADMIN],
  },
];

interface SidebarProps {
  userRole: Role;
  collapsed?: boolean;
}

export function Sidebar({ userRole, collapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r bg-card transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-16 items-center border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-primary-foreground">A</span>
            </div>
            {!collapsed && (
              <span className="text-xl font-bold text-primary">AestheTech</span>
            )}
          </Link>
        </div>
        <ScrollArea className="h-[calc(100vh-4rem)]">
          <nav className="flex flex-col gap-1 p-2">
            {filteredNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-md transition-colors mx-auto",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        <span className="sr-only">{item.title}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {item.title}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {item.title}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>
    </TooltipProvider>
  );
}

export function MobileSidebar({ userRole }: { userRole: Role }) {
  const pathname = usePathname();
  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  );

  return (
    <nav className="flex flex-col gap-1 p-2">
      {filteredNavItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
