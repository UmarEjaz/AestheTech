"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoleList } from "@/components/settings/role-list";
import { RoleForm } from "@/components/settings/role-form";
import { type RoleInfo } from "@/lib/actions/role";

interface RolesPageClientProps {
  roles: RoleInfo[];
}

export function RolesPageClient({ roles }: RolesPageClientProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleInfo | undefined>();

  const handleEdit = (role: RoleInfo) => {
    setEditingRole(role);
    setShowForm(true);
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingRole(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/settings">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Manage Roles</h1>
            <p className="text-muted-foreground">
              Create custom roles and manage role hierarchy
            </p>
          </div>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingRole(undefined); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Create Custom Role
          </Button>
        )}
      </div>

      {showForm && (
        <RoleForm role={editingRole} onClose={handleClose} />
      )}

      <RoleList roles={roles} onEdit={handleEdit} />
    </div>
  );
}
