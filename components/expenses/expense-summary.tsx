"use client";

import { TrendingUp, TrendingDown, DollarSign, Wallet, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/currency";

interface ExpenseSummaryProps {
  todayIncome: number;
  todayExpenses: number;
  monthIncome: number;
  monthExpenses: number;
  currencyCode: string;
}

export function ExpenseSummary({
  todayIncome,
  todayExpenses,
  monthIncome,
  monthExpenses,
  currencyCode,
}: ExpenseSummaryProps) {
  const todayNet = todayIncome - todayExpenses;
  const monthNet = monthIncome - monthExpenses;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Today's Income */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today&apos;s Income</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {formatCurrency(todayIncome, currencyCode)}
          </div>
        </CardContent>
      </Card>

      {/* Today's Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today&apos;s Expenses</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {formatCurrency(todayExpenses, currencyCode)}
          </div>
        </CardContent>
      </Card>

      {/* Today's Net */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today&apos;s Net</CardTitle>
          {todayNet >= 0 ? (
            <TrendingUp className="h-4 w-4 text-green-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${todayNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {formatCurrency(todayNet, currencyCode)}
          </div>
        </CardContent>
      </Card>

      {/* Month Net */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">This Month&apos;s Net</CardTitle>
          <div className="flex items-center gap-1">
            {monthNet >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${monthNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {formatCurrency(monthNet, currencyCode)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="text-green-600 dark:text-green-400">{formatCurrency(monthIncome, currencyCode)}</span>
            {" "}
            <ArrowRight className="h-3 w-3 inline" />
            {" "}
            <span className="text-red-600 dark:text-red-400">{formatCurrency(monthExpenses, currencyCode)}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
