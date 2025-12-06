"use client";

import Link from "next/link";
import { Clock, DollarSign, Gift, MoreVertical, Edit, Trash2, Calendar, ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ServiceListItem } from "@/lib/actions/service";

interface ServiceCardProps {
  service: ServiceListItem;
  onDelete?: (id: string) => void;
  canManage?: boolean;
}

export function ServiceCard({ service, onDelete, canManage = false }: ServiceCardProps) {
  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{service.name}</CardTitle>
            {service.category && (
              <Badge variant="secondary" className="text-xs">
                {service.category}
              </Badge>
            )}
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/services/${service.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Link>
                </DropdownMenuItem>
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete(service.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {service.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {service.description}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{formatDuration(service.duration)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span>${Number(service.price).toFixed(2)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Gift className="h-3.5 w-3.5" />
            <span>{service.points} pts</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              <span>{service._count.appointments}</span>
            </div>
            <div className="flex items-center gap-1">
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>{service._count.saleItems}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
