"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Edit, Loader2, Power } from "lucide-react";
import { toast } from "sonner";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { expenseCategorySchema, ExpenseCategoryInput } from "@/lib/validations/expense";
import {
  createExpenseCategory,
  updateExpenseCategory,
  toggleExpenseCategory,
  ExpenseCategoryItem,
} from "@/lib/actions/expense-category";

interface CategoryManagerProps {
  categories: ExpenseCategoryItem[];
}

export function CategoryManager({ categories }: CategoryManagerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const editingCategory = editingId ? categories.find((c) => c.id === editingId) : null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExpenseCategoryInput>({
    resolver: zodResolver(expenseCategorySchema),
    defaultValues: { name: "", icon: "", color: "" },
  });

  const openCreate = () => {
    setEditingId(null);
    reset({ name: "", icon: "", color: "" });
    setIsOpen(true);
  };

  const openEdit = (category: ExpenseCategoryItem) => {
    setEditingId(category.id);
    reset({ name: category.name, icon: category.icon || "", color: category.color || "" });
    setIsOpen(true);
  };

  const onSubmit = async (data: ExpenseCategoryInput) => {
    setIsSubmitting(true);
    try {
      if (editingId) {
        const result = await updateExpenseCategory(editingId, data);
        if (result.success) {
          toast.success("Category updated");
          setIsOpen(false);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      } else {
        const result = await createExpenseCategory(data);
        if (result.success) {
          toast.success("Category created");
          setIsOpen(false);
          router.refresh();
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
    setTogglingId(id);
    try {
      const result = await toggleExpenseCategory(id);
      if (result.success) {
        toast.success(result.data.isActive ? "Category restored" : "Category deactivated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Expense Categories</CardTitle>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Category
            </Button>
          </DialogTrigger>
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
                  placeholder="e.g. Office Supplies"
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
                    placeholder="e.g. Package"
                  />
                  {errors.icon && (
                    <p className="text-sm text-destructive">{errors.icon.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="color"
                      type="color"
                      {...register("color")}
                      className="w-12 h-10 p-1 cursor-pointer"
                    />
                    <Input
                      {...register("color")}
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
                <TableHead>Expenses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
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
                    {category._count.expenses}
                  </TableCell>
                  <TableCell>
                    <Badge variant={category.isActive ? "default" : "secondary"}>
                      {category.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(category)}
                      >
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No categories found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
