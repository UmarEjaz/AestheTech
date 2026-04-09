import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { hasPermission } from "@/lib/permissions";
import { getAuditLogs, getAuditActions, getAuditEntityTypes } from "@/lib/actions/audit";
import { getActiveStaff } from "@/lib/actions/user";
import { getBranches } from "@/lib/actions/branch";
import { AuditLogClient } from "@/components/audit/audit-log-client";
import { BranchFilter } from "@/components/dashboard/branch-filter";

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
    branch?: string;
  }>;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  if (!session.user.salonRole && !session.user.isSuperAdmin) {
    redirect("/dashboard/access-denied");
  }
  const userRole = session.user.salonRole ?? null;
  const isSuperAdmin = session.user.isSuperAdmin === true;
  const isOwner = userRole === "OWNER" || isSuperAdmin;

  const salonId = session.user.salonId;
  if (!(await hasPermission(userRole, "audit:view", isSuperAdmin, salonId, session.user.id))) {
    redirect("/dashboard/access-denied");
  }

  const params = await searchParams;
  const page = params.page ? parseInt(params.page) : 1;
  const branchFilter = isOwner && params.branch === "all" ? "all" as const : "current" as const;

  const [logsResult, actionsResult, entityTypesResult, staffResult, branchesResult] = await Promise.all([
    getAuditLogs({
      page,
      pageSize: 50,
      action: params.action,
      entityType: params.entityType,
      userId: params.userId,
      from: params.from,
      to: params.to,
      branchFilter,
    }),
    getAuditActions(branchFilter),
    getAuditEntityTypes(branchFilter),
    getActiveStaff(branchFilter),
    isOwner ? getBranches() : Promise.resolve(null),
  ]);

  const hasMultipleBranches = branchesResult?.success && branchesResult.data.length > 1;
  const currentSalonName = branchesResult?.success
    ? branchesResult.data.find((b) => b.id === session.user.salonId)?.name
    : undefined;

  if (!logsResult.success) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-destructive">{logsResult.error}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {hasMultipleBranches && (
        <div className="flex justify-end mb-4">
          <BranchFilter
            currentFilter={branchFilter}
            currentSalonName={currentSalonName}
          />
        </div>
      )}
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
