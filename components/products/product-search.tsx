"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Filter, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProductSearchProps {
  categories: string[];
}

export function ProductSearch({ categories }: ProductSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const selectedCategory = searchParams.get("category") || "";
  const lowStock = searchParams.get("lowStock") === "true";

  const updateUrl = (newQuery: string, newCategory: string, newLowStock: boolean) => {
    const params = new URLSearchParams();
    if (newQuery) params.set("q", newQuery);
    if (newCategory) params.set("category", newCategory);
    if (newLowStock) params.set("lowStock", "true");
    params.set("page", "1");

    startTransition(() => {
      router.push(`/dashboard/products?${params.toString()}`);
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrl(query, selectedCategory, lowStock);
  };

  const handleCategorySelect = (category: string) => {
    updateUrl(query, category === selectedCategory ? "" : category, lowStock);
  };

  const handleLowStockToggle = () => {
    updateUrl(query, selectedCategory, !lowStock);
  };

  const handleClearAll = () => {
    setQuery("");
    startTransition(() => {
      router.push("/dashboard/products");
    });
  };

  const hasFilters = query || selectedCategory || lowStock;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Searching..." : "Search"}
        </Button>
        {categories.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Category
                {selectedCategory && (
                  <Badge variant="secondary" className="ml-1">
                    1
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Filter by Category</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {categories.map((category) => (
                <DropdownMenuItem
                  key={category}
                  onClick={() => handleCategorySelect(category)}
                  className={selectedCategory === category ? "bg-accent" : ""}
                >
                  {category}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          type="button"
          variant={lowStock ? "default" : "outline"}
          className="gap-2"
          onClick={handleLowStockToggle}
        >
          <AlertTriangle className="h-4 w-4" />
          Low Stock
        </Button>
      </form>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {query && (
            <Badge variant="secondary" className="gap-1">
              Search: {query}
              <button
                onClick={() => {
                  setQuery("");
                  updateUrl("", selectedCategory, lowStock);
                }}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {selectedCategory && (
            <Badge variant="secondary" className="gap-1">
              {selectedCategory}
              <button
                onClick={() => handleCategorySelect(selectedCategory)}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {lowStock && (
            <Badge variant="secondary" className="gap-1">
              Low Stock
              <button
                onClick={handleLowStockToggle}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
