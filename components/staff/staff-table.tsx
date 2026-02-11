"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatInTz } from "@/lib/utils/timezone";
import {
  Search,
  Plus,
  Eye,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Loader2,
  Users,
  Shield,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { Role } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "@/components/ui/alert-dialog";
import { UserListItem, deleteUser, toggleUserActive } from "@/lib/actions/user";

interface StaffTableProps {
  initialUsers: UserListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  timezone: string;
  fetchUsers: (params: {
    query?: string;
    role?: Role;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) => Promise<{
    success: boolean;
    data?: {
      users: UserListItem[];
      total: number;
      page: number;
      totalPages: number;
    };
    error?: string;
  }>;
}

const ROLE_COLORS: Record<Role, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  OWNER: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  ADMIN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  STAFF: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  RECEPTIONIST: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER: "Owner",
  ADMIN: "Admin",
  STAFF: "Staff",
  RECEPTIONIST: "Receptionist",
};

export function StaffTable({
  initialUsers,
  initialTotal,
  initialPage,
  initialTotalPages,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  timezone,
  fetchUsers,
}: StaffTableProps) {
  const router = useRouter();
  const [users, setUsers] = useState<UserListItem[]>(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toggleId, setToggleId] = useState<string | null>(null);
  const [toggleAction, setToggleAction] = useState<"activate" | "deactivate">("deactivate");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadUsers = useCallback(async (search: string, pageNum: number, role?: Role, isActive?: boolean) => {
    setLoading(true);
    try {
      const result = await fetchUsers({
        query: search || undefined,
        role: role,
        isActive: isActive,
        page: pageNum,
        limit: 15,
      });

      if (result.success && result.data) {
        setUsers(result.data.users);
        setTotal(result.data.total);
        setPage(result.data.page);
        setTotalPages(result.data.totalPages);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchUsers]);

  // Debounced search
  const debouncedSearch = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const role = roleFilter === "ALL" ? undefined : roleFilter;
      const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
      loadUsers(value, 1, role, isActive);
    }, 400);
  }, [loadUsers, roleFilter, statusFilter]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);

    if (value.trim() === "") {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      const role = roleFilter === "ALL" ? undefined : roleFilter;
      const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
      loadUsers("", 1, role, isActive);
    } else {
      debouncedSearch(value);
    }
  };

  // Handle filter changes
  const handleRoleFilterChange = (value: string) => {
    const role = value as Role | "ALL";
    setRoleFilter(role);
    const roleValue = role === "ALL" ? undefined : role;
    const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
    loadUsers(searchTerm, 1, roleValue, isActive);
  };

  const handleStatusFilterChange = (value: string) => {
    const status = value as "ALL" | "ACTIVE" | "INACTIVE";
    setStatusFilter(status);
    const role = roleFilter === "ALL" ? undefined : roleFilter;
    const isActive = status === "ALL" ? undefined : status === "ACTIVE";
    loadUsers(searchTerm, 1, role, isActive);
  };

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    const role = roleFilter === "ALL" ? undefined : roleFilter;
    const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
    loadUsers(searchTerm, newPage, role, isActive);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    const result = await deleteUser(deleteId);
    if (result.success) {
      toast.success("User deleted successfully");
      setDeleteId(null);
      const role = roleFilter === "ALL" ? undefined : roleFilter;
      const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
      loadUsers(searchTerm, page, role, isActive);
    } else {
      toast.error(result.error);
    }
  };

  const handleToggleActive = async () => {
    if (!toggleId) return;

    const result = await toggleUserActive(toggleId);
    if (result.success) {
      toast.success(`User ${result.data.isActive ? "activated" : "deactivated"} successfully`);
      setToggleId(null);
      const role = roleFilter === "ALL" ? undefined : roleFilter;
      const isActive = statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE";
      loadUsers(searchTerm, page, role, isActive);
    } else {
      toast.error(result.error);
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
  };

  const activeUsers = users.filter(u => u.isActive).length;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Total Staff</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <UserCheck className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-2xl font-bold">{activeUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <UserX className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm font-medium">Inactive</p>
                <p className="text-2xl font-bold">{users.length - activeUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex-1 relative w-full md:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
            <Select value={roleFilter} onValueChange={handleRoleFilterChange}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="STAFF">Staff</SelectItem>
                <SelectItem value="RECEPTIONIST">Receptionist</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {canCreate && (
              <Button onClick={() => router.push("/dashboard/staff/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Staff
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Staff Table */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Members</CardTitle>
          <CardDescription>
            {total} total staff • Page {page} of {totalPages || 1}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No staff found</h3>
                    <p className="text-muted-foreground mb-4">
                      {searchTerm || roleFilter !== "ALL" || statusFilter !== "ALL"
                        ? "No staff match your search criteria."
                        : "Get started by adding your first staff member."}
                    </p>
                    {canCreate && (
                      <Button onClick={() => router.push("/dashboard/staff/new")}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Your First Staff Member
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow
                    key={user.id}
                    className={`cursor-pointer ${!user.isActive ? "opacity-60" : ""}`}
                    onClick={() => router.push(`/dashboard/staff/${user.id}`)}
                  >
                    <TableCell>
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-purple-100 text-purple-600">
                          {getInitials(user.firstName, user.lastName)}
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {user.firstName} {user.lastName}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {user.email && (
                          <p className="text-sm flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </p>
                        )}
                        {user.phone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {user.phone}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={ROLE_COLORS[user.role]}>
                        <Shield className="h-3 w-3 mr-1" />
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.isActive ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {user._count.appointments} services
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatInTz(user.createdAt, "MMM d, yyyy", timezone)}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => router.push(`/dashboard/staff/${user.id}`)}
                          title="View staff"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => router.push(`/dashboard/staff/${user.id}/edit`)}
                              title="Edit staff"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-8 w-8 p-0 ${user.isActive ? "hover:bg-orange-100 dark:hover:bg-orange-900/20 hover:text-orange-600" : "hover:bg-green-100 dark:hover:bg-green-900/20 hover:text-green-600"}`}
                              onClick={() => {
                                setToggleId(user.id);
                                setToggleAction(user.isActive ? "deactivate" : "activate");
                              }}
                              title={user.isActive ? "Deactivate" : "Activate"}
                            >
                              {user.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </Button>
                          </>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900/20 hover:text-red-600"
                            onClick={() => setDeleteId(user.id)}
                            title="Delete staff"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * 15 + 1} to {Math.min(page * 15, total)} of{" "}
                {total} staff
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || loading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Toggle Active Confirmation Dialog */}
      <AlertDialog open={!!toggleId} onOpenChange={() => setToggleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleAction === "deactivate" ? "Deactivate Staff Member?" : "Activate Staff Member?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleAction === "deactivate"
                ? "This staff member will no longer be able to log in. Their appointment and sales history will be preserved."
                : "This staff member will be able to log in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleToggleActive}
              className={toggleAction === "deactivate" ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}
            >
              {toggleAction === "deactivate" ? "Deactivate" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Staff Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. If the staff member has appointments or sales history,
              please deactivate them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
