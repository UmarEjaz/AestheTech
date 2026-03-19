import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { getAuditLogs, getAuditActions, getAuditEntityTypes } from "@/lib/actions/audit";
import { getActiveStaff } from "@/lib/actions/user";
import { AuditLogClient } from "@/components/audit/audit-log-client";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    action?: string;
    entityType?: string;
    userId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole as Role;
  const isSuperAdmin = session.user.isSuperAdmin === true;

  if (!hasPermission(userRole, "audit:view", isSuperAdmin)) {
    redirect("/dashboard/access-denied");
  }

  const params = await searchParams;
  const page = params.page ? parseInt(params.page) : 1;

  const [logsResult, actionsResult, entityTypesResult, staffResult] = await Promise.all([
    getAuditLogs({
      page,
      pageSize: 50,
      action: params.action,
      entityType: params.entityType,
      userId: params.userId,
      from: params.from,
      to: params.to,
    }),
    getAuditActions(),
    getAuditEntityTypes(),
    getActiveStaff(),
  ]);

  if (!logsResult.success) {
    return (
      <DashboardLayout userRole={userRole}>
        <div className="text-center py-12">
          <p className="text-destructive">{logsResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout userRole={userRole}>
      <AuditLogClient
        logs={logsResult.data.logs}
        total={logsResult.data.total}
        page={logsResult.data.page}
        pageSize={logsResult.data.pageSize}
        actions={actionsResult.success ? actionsResult.data : []}
        entityTypes={entityTypesResult.success ? entityTypesResult.data : []}
        staff={staffResult.success ? staffResult.data : []}
        filters={{
          action: params.action,
          entityType: params.entityType,
          userId: params.userId,
          from: params.from,
          to: params.to,
        }}
      />
    </DashboardLayout>
  );
}
