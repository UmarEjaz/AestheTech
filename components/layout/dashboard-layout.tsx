"use client";

import { useState } from "react";
import { Role } from "@prisma/client";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: React.ReactNode;
  userRole: Role;
}

export function DashboardLayout({ children, userRole }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar userRole={userRole} collapsed={sidebarCollapsed} />
      </div>

      {/* Header */}
      <Header
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <main
        className={cn(
          "pt-16 transition-all duration-300",
          sidebarCollapsed ? "md:pl-16" : "md:pl-64"
        )}
      >
        <div className="container mx-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
