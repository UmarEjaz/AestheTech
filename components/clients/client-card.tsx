"use client";

import Link from "next/link";
import { Phone, Mail, Calendar, Gift, MoreVertical, Edit, Trash2, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoyaltyTier } from "@prisma/client";
import { ClientListItem } from "@/lib/actions/client";

interface ClientCardProps {
  client: ClientListItem;
  onDelete?: (id: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  loyaltyEnabled?: boolean;
}

const tierColors: Record<LoyaltyTier, string> = {
  SILVER: "bg-gray-400",
  GOLD: "bg-yellow-500",
  PLATINUM: "bg-purple-500",
};

export function ClientCard({ client, onDelete, canEdit = true, canDelete = false, loyaltyEnabled = true }: ClientCardProps) {
  const initials = `${client.firstName[0]}${client.lastName?.[0] || ""}`.toUpperCase();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <Link href={`/dashboard/clients/${client.id}`} className="flex items-start gap-3 flex-1">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground truncate">
                  {client.firstName} {client.lastName}
                </h3>
                {client.isWalkIn && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    Walk-in
                  </Badge>
                )}
              </div>
              {client.phone ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <Phone className="h-3.5 w-3.5" />
                  <span>{client.phone}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground/60 mt-1">
                  <Phone className="h-3.5 w-3.5" />
                  <span className="italic">No phone</span>
                </div>
              )}
              {client.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="truncate">{client.email}</span>
                </div>
              )}
            </div>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/clients/${client.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/clients/${client.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Link>
                </DropdownMenuItem>
              )}
              {canDelete && onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(client.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span>{client._count.appointments} appts</span>
            </div>
            {loyaltyEnabled && client.loyaltyPoints && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Gift className="h-3.5 w-3.5" />
                <span>{client.loyaltyPoints.balance} pts</span>
                <span
                  className={`h-2 w-2 rounded-full ${tierColors[client.loyaltyPoints.tier]}`}
                  title={client.loyaltyPoints.tier}
                />
              </div>
            )}
          </div>
        </div>

        {client.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {client.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {client.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{client.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
