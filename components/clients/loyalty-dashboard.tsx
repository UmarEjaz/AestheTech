"use client";

import { format } from "date-fns";
import {
  Gift,
  TrendingUp,
  TrendingDown,
  Star,
  Clock,
  AlertTriangle,
  Cake,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoyaltyTier, LoyaltyTransactionType } from "@prisma/client";
import {
  calculateLoyaltyStats,
  getNextTier,
  getPointsToNextTier,
  getTierProgress,
  hasReceivedBirthdayBonusThisYear,
  TierThresholds,
} from "@/lib/utils/loyalty";

interface LoyaltyTransaction {
  id: string;
  points: number;
  type: LoyaltyTransactionType;
  description: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

interface LoyaltyDashboardProps {
  balance: number;
  tier: LoyaltyTier;
  transactions: LoyaltyTransaction[];
  thresholds: TierThresholds;
}

const tierColors: Record<LoyaltyTier, string> = {
  SILVER: "bg-gray-400",
  GOLD: "bg-yellow-500",
  PLATINUM: "bg-purple-500",
};

const tierBadgeVariants: Record<LoyaltyTier, "secondary" | "default" | "outline"> = {
  SILVER: "secondary",
  GOLD: "default",
  PLATINUM: "default",
};

const typeIcons: Record<LoyaltyTransactionType, typeof TrendingUp> = {
  EARNED: TrendingUp,
  REDEEMED: TrendingDown,
  BONUS: Gift,
  EXPIRED: Clock,
  ADJUSTMENT: Star,
};

const typeColors: Record<LoyaltyTransactionType, string> = {
  EARNED: "text-green-600",
  REDEEMED: "text-blue-600",
  BONUS: "text-purple-600",
  EXPIRED: "text-red-600",
  ADJUSTMENT: "text-gray-600",
};

export function LoyaltyDashboard({
  balance,
  tier,
  transactions,
  thresholds,
}: LoyaltyDashboardProps) {
  const stats = calculateLoyaltyStats(transactions);
  const nextTier = getNextTier(tier);
  const progress = getTierProgress(balance, tier, thresholds);
  const pointsNeeded = getPointsToNextTier(balance, tier, thresholds);
  const birthdayBonusReceived = hasReceivedBirthdayBonusThisYear(transactions);
  const currentYear = new Date().getFullYear();

  // Points expiring within 30 days
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringPoints = transactions
    .filter(
      (t) =>
        t.expiresAt &&
        new Date(t.expiresAt) <= thirtyDaysFromNow &&
        new Date(t.expiresAt) > now &&
        (t.type === "EARNED" || t.type === "BONUS")
    )
    .reduce((sum, t) => sum + t.points, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5" />
          Loyalty Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Balance + Tier + Progress */}
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold">{balance}</span>
                <span className="text-lg text-muted-foreground">points</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`h-3 w-3 rounded-full ${tierColors[tier]}`} />
                <Badge variant={tierBadgeVariants[tier]}>{tier}</Badge>
              </div>
            </div>
          </div>
          <div className="flex-1 max-w-xs">
            {nextTier ? (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tier}</span>
                  <span className="text-muted-foreground">{nextTier}</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {pointsNeeded} points to {nextTier}
                </p>
              </div>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Highest Tier Achieved!
              </Badge>
            )}
          </div>
        </div>

        {/* Status Row: Birthday + Expiry Warning */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2">
            <Cake className="h-4 w-4 text-purple-500" />
            <span className="text-muted-foreground">Birthday Bonus {currentYear}:</span>
            {birthdayBonusReceived ? (
              <span className="flex items-center gap-1 text-green-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Received
              </span>
            ) : (
              <span className="text-muted-foreground">Not yet received</span>
            )}
          </div>

          {expiringPoints > 0 && (
            <div className="flex items-center gap-2 text-sm rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                {expiringPoints} points expiring within 30 days
              </span>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.totalEarned}</p>
            <p className="text-xs text-muted-foreground">Total Earned</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.totalRedeemed}</p>
            <p className="text-xs text-muted-foreground">Total Redeemed</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">{stats.totalBonus}</p>
            <p className="text-xs text-muted-foreground">Total Bonus</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.totalExpired}</p>
            <p className="text-xs text-muted-foreground">Total Expired</p>
          </div>
        </div>

        {/* Transaction History Table */}
        {transactions.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-3">Transaction History</h4>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Points</TableHead>
                    <TableHead className="hidden sm:table-cell">Description</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.slice(0, 20).map((tx) => {
                    const Icon = typeIcons[tx.type];
                    return (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <div className={`flex items-center gap-1.5 ${typeColors[tx.type]}`}>
                            <Icon className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">{tx.type}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`font-semibold ${tx.points >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {tx.points >= 0 ? "+" : ""}{tx.points}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                          {tx.description || "-"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {tx.expiresAt
                            ? format(new Date(tx.expiresAt), "MMM d, yyyy")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(tx.createdAt), "MMM d, yyyy")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {transactions.length > 20 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                Showing most recent 20 of {transactions.length} transactions
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
