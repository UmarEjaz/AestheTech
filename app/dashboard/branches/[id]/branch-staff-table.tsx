"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import {
  assignStaffToBranch,
  removeStaffFromBranch,
  getAvailableStaffForBranch,
} from "@/lib/actions/staff-transfer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, UserMinus } from "lucide-react";

type StaffMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  isActive: boolean;
};

type AvailableStaff = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
};

interface BranchStaffTableProps {
  branchId: string;
  staff: StaffMember[];
  canManage: boolean;
}

export function BranchStaffTable({ branchId, staff, canManage }: BranchStaffTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableStaff, setAvailableStaff] = useState<AvailableStaff[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role>(Role.STAFF);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  async function openAddDialog() {
    setLoadingAvailable(true);
    setDialogOpen(true);
    const result = await getAvailableStaffForBranch(branchId);
    if (result.success) {
      setAvailableStaff(result.data);
    } else {
      toast.error(result.error);
    }
    setLoadingAvailable(false);
  }

  function handleAssign() {
    if (!selectedUserId) return;
    startTransition(async () => {
      const result = await assignStaffToBranch(selectedUserId, branchId, selectedRole);
      if (result.success) {
        toast.success("Staff member has been assigned to this branch.");
        setDialogOpen(false);
        setSelectedUserId("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove(userId: string, name: string) {
    startTransition(async () => {
      const result = await removeStaffFromBranch(userId, branchId);
      if (result.success) {
        toast.success(`${name} has been removed from this branch.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Staff ({staff.length})</CardTitle>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Staff
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Staff to Branch</DialogTitle>
                <DialogDescription>
                  Select a staff member from your organization to assign to this branch.
                </DialogDescription>
              </DialogHeader>
              {loadingAvailable ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : availableStaff.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  All staff members are already assigned to this branch.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Staff Member</label>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select staff member" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableStaff.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.firstName} {s.lastName} ({s.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Role at this branch</label>
                    <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as Role)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={Role.ADMIN}>Admin</SelectItem>
                        <SelectItem value={Role.STAFF}>Staff</SelectItem>
                        <SelectItem value={Role.RECEPTIONIST}>Receptionist</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleAssign}
                    disabled={!selectedUserId || isPending}
                    className="w-full"
                  >
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Assign to Branch
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No staff assigned to this branch yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.firstName} {member.lastName}
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {member.role.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.isActive ? "default" : "secondary"}>
                      {member.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={isPending}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Staff</AlertDialogTitle>
                            <AlertDialogDescription>
                              Remove {member.firstName} {member.lastName} from this branch?
                              They will still belong to other branches they&apos;re assigned to.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                handleRemove(member.id, `${member.firstName} ${member.lastName}`)
                              }
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
