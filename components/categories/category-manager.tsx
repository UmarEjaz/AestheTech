"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Edit, Loader2, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { categorySchema, type CategoryInput } from "@/lib/validations/category";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CategoryItem = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count: Record<string, number>;
};

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

interface CategoryManagerProps {
  title: string;
  countLabel: string;
  categories: CategoryItem[];
  onCreate?: (data: CategoryInput) => Promise<ActionResult<{ id: string }>>;
  onUpdate?: (id: string, data: CategoryInput) => Promise<ActionResult<{ id: string }>>;
  onToggle?: (id: string) => Promise<ActionResult<{ isActive: boolean }>>;
  onDelete?: (id: string) => Promise<ActionResult<{ hardDeleted: boolean }>>;
  namePlaceholder?: string;
  iconPlaceholder?: string;
}

export function CategoryManager({
  title,
  countLabel,
  categories,
  onCreate,
  onUpdate,
  onToggle,
  onDelete,
  namePlaceholder = "e.g. Hair Care",
  iconPlaceholder = "e.g. Scissors",
}: CategoryManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", icon: "", color: "" },
  });

  const openCreate = () => {
    setEditingId(null);
    reset({ name: "", icon: "", color: "" });
    setIsOpen(true);
  };

  const openEdit = (category: CategoryItem) => {
    setEditingId(category.id);
    reset({ name: category.name, icon: category.icon || "", color: category.color || "" });
    setIsOpen(true);
  };

  const onSubmit = async (data: CategoryInput) => {
    setIsSubmitting(true);
    try {
      if (editingId) {
        if (!onUpdate) return;
        const result = await onUpdate(editingId, data);
        if (result.success) {
          toast.success("Category updated");
          setIsOpen(false);
        } else {
          toast.error(result.error);
        }
      } else {
        if (!onCreate) return;
        const result = await onCreate(data);
        if (result.success) {
          toast.success("Category created");
          setIsOpen(false);
        } else {
          toast.error(result.error);
        }
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (id: string) => {
    if (!onToggle) return;
    setTogglingId(id);
    try {
      const result = await onToggle(id);
      if (result.success) {
        toast.success(result.data.isActive ? "Category restored" : "Category deactivated");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    setDeletingId(id);
    setConfirmingDeleteId(null);
    try {
      const result = await onDelete(id);
      if (result.success) {
        toast.success("Category deleted");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setDeletingId(null);
    }
  };

  const getCount = (category: CategoryItem) => {
    const counts = Object.values(category._count);
    return counts[0] ?? 0;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          {onCreate && (
            <DialogTrigger asChild>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Category" : "New Category"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  {...register("name")}
                  placeholder={namePlaceholder}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="icon">Icon (Lucide name)</Label>
                  <Input
                    id="icon"
                    {...register("icon")}
                    placeholder={iconPlaceholder}
                  />
                  {errors.icon && (
                    <p className="text-sm text-destructive">{errors.icon.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <div className="flex gap-2">
                    {/* Both inputs are fully controlled via watch/setValue so the picker
                        and the hex text always stay in sync. Mixing register() with a
                        controlled sibling on the same field would silently desync them. */}
                    <Input
                      id="color"
                      type="color"
                      value={watch("color") || "#000000"}
                      onChange={(e) => setValue("color", e.target.value, { shouldValidate: true })}
                      className="w-12 h-10 p-1 cursor-pointer"
                    />
                    <Input
                      value={watch("color") || ""}
                      onChange={(e) => setValue("color", e.target.value, { shouldValidate: true })}
                      placeholder="#6366F1"
                      className="flex-1"
                    />
                  </div>
                  {errors.color && (
                    <p className="text-sm text-destructive">{errors.color.message}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingId ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Color</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>{countLabel}</TableHead>
                <TableHead>Status</TableHead>
                {(onUpdate || onToggle || onDelete) && <TableHead className="w-[140px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    {category.color ? (
                      <span
                        className="inline-block h-5 w-5 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                    ) : (
                      <span className="inline-block h-5 w-5 rounded-full bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {category.name}
                    {category.isDefault && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        Default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getCount(category)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={category.isActive ? "default" : "secondary"}>
                      {category.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  {(onUpdate || onToggle || onDelete) && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {onUpdate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(category)}
                          >
                            <Edit className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        )}
                        {onToggle && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleToggle(category.id)}
                            disabled={togglingId === category.id}
                          >
                            {togglingId === category.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                            <span className="sr-only">
                              {category.isActive ? "Deactivate" : "Activate"}
                            </span>
                          </Button>
                        )}
                        {onDelete && (() => {
                          const refCount = getCount(category);
                          const isReferenced = refCount > 0;
                          const tooltipText = isReferenced
                            ? `Cannot delete: ${refCount} ${countLabel.toLowerCase()} use this category. Deactivate it instead.`
                            : "Delete this category permanently";
                          return (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span tabIndex={isReferenced ? 0 : -1}>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                      onClick={() => setConfirmingDeleteId(category.id)}
                                      disabled={isReferenced || deletingId === category.id}
                                    >
                                      {deletingId === category.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                      <span className="sr-only">Delete</span>
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{tooltipText}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={(onUpdate || onToggle || onDelete) ? 5 : 4} className="text-center text-muted-foreground py-8">
                    No categories found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog
        open={confirmingDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the category. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmingDeleteId && handleDelete(confirmingDeleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
