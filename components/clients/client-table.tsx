"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
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
  Star,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientListItem, deleteClient } from "@/lib/actions/client";

interface ClientTableProps {
  initialClients: ClientListItem[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  loyaltyEnabled?: boolean;
  fetchClients: (params: {
    query?: string;
    page?: number;
    limit?: number;
    isWalkIn?: boolean;
  }) => Promise<{
    success: boolean;
    data?: {
      clients: ClientListItem[];
      total: number;
      page: number;
      totalPages: number;
    };
    error?: string;
  }>;
}

export function ClientTable({
  initialClients,
  initialTotal,
  initialPage,
  initialTotalPages,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  loyaltyEnabled = true,
  fetchClients,
}: ClientTableProps) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientListItem[]>(initialClients);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [searchTerm, setSearchTerm] = useState("");
  const [walkInFilter, setWalkInFilter] = useState<"all" | "walkin" | "regular">("all");
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadClients = useCallback(async (search: string, pageNum: number, walkIn: "all" | "walkin" | "regular" = "all") => {
    setLoading(true);
    try {
      const result = await fetchClients({
        query: search || undefined,
        page: pageNum,
        limit: 15,
        isWalkIn: walkIn === "all" ? undefined : walkIn === "walkin",
      });

      if (result.success && result.data) {
        setClients(result.data.clients);
        setTotal(result.data.total);
        setPage(result.data.page);
        setTotalPages(result.data.totalPages);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchClients]);

  // Debounced search
  const debouncedSearch = useCallback((value: string, walkIn: "all" | "walkin" | "regular") => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      loadClients(value, 1, walkIn);
    }, 400);
  }, [loadClients]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);

    if (value.trim() === "") {
      // If cleared, search immediately
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      loadClients("", 1, walkInFilter);
    } else {
      debouncedSearch(value, walkInFilter);
    }
  };

  // Handle walk-in filter change
  const handleWalkInFilterChange = (value: "all" | "walkin" | "regular") => {
    setWalkInFilter(value);
    loadClients(searchTerm, 1, value);
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
    loadClients(searchTerm, newPage, walkInFilter);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    const result = await deleteClient(deleteId);
    if (result.success) {
      toast.success("Client deleted successfully");
      setDeleteId(null);
      loadClients(searchTerm, page, walkInFilter);
    } else {
      toast.error(result.error);
    }
  };

  const getInitials = (firstName: string, lastName: string | null) => {
    return `${firstName[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Total Clients</p>
                <p className="text-2xl font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
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
            <Select value={walkInFilter} onValueChange={handleWalkInFilterChange}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                <SelectItem value="walkin">Walk-ins Only</SelectItem>
                <SelectItem value="regular">Regular Only</SelectItem>
              </SelectContent>
            </Select>
            {canCreate && (
              <Button onClick={() => router.push("/dashboard/clients/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Client
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Clients Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Clients</CardTitle>
          <CardDescription>
            {total} total clients • Page {page} of {totalPages || 1}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Tags</TableHead>
                {loyaltyEnabled && <TableHead>Loyalty Points</TableHead>}
                <TableHead>Visits</TableHead>
                <TableHead>Member Since</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={loyaltyEnabled ? 8 : 7} className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No clients found</h3>
                    <p className="text-muted-foreground mb-4">
                      {searchTerm
                        ? "No clients match your search criteria."
                        : "Get started by adding your first client."}
                    </p>
                    {canCreate && (
                      <Button onClick={() => router.push("/dashboard/clients/new")}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Your First Client
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow
                    key={client.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                  >
                    <TableCell>
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-purple-100 text-purple-600">
                          {getInitials(client.firstName, client.lastName)}
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {client.firstName} {client.lastName}
                          </p>
                          {client.isWalkIn && (
                            <Badge variant="outline" className="text-xs">
                              Walk-in
                            </Badge>
                          )}
                        </div>
                        {client.notes && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {client.notes}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {client.phone ? (
                          <p className="text-sm flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {client.phone}
                          </p>
                        ) : (
                          <p className="text-sm flex items-center gap-1 text-muted-foreground/60">
                            <Phone className="h-3 w-3" />
                            <span className="italic">No phone</span>
                          </p>
                        )}
                        {client.email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {client.email}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {client.tags.length > 0 ? (
                          client.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No tags</span>
                        )}
                        {client.tags.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{client.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    {loyaltyEnabled && (
                    <TableCell>
                      {client.loyaltyPoints ? (
                        <div className="flex items-center gap-1">
                          <Star className="h-4 w-4 text-yellow-500" />
                          <span className="font-medium">
                            {client.loyaltyPoints.balance}
                          </span>
                          <Badge variant="outline" className="text-xs ml-1">
                            {client.loyaltyPoints.tier}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    )}
                    <TableCell>
                      <span className="text-sm">
                        {client._count.appointments} visits
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(client.createdAt), "MMM d, yyyy")}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                          title="View client"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => router.push(`/dashboard/clients/${client.id}/edit`)}
                            title="Edit client"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900/20 hover:text-red-600"
                            onClick={() => setDeleteId(client.id)}
                            title="Delete client"
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
                {total} clients
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the client. Their appointment and sale history
              will be preserved. You can restore the client later if needed.
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
