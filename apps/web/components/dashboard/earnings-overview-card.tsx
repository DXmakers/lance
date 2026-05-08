"use client";

/**
 * EarningsOverviewCard - Primary earnings display with sparkline
 * 
 * Features:
 * - Total earnings display
 * - Pending payouts
 * - Recent income sparkline
 * - Monospace financial typography
 */

import { TrendingUp, Clock, DollarSign } from "lucide-react";
import { GlassCard } from "./glass-card";
import { SparklineChart } from "./sparkline-chart";

export interface EarningsData {
  totalEarnings: number;
  pendingPayouts: number;
  recentIncome: number[];
  currency?: string;
}

export interface EarningsOverviewCardProps {
  data: EarningsData;
  className?: string;
}

export function EarningsOverviewCard({
  data,
  className = "",
}: EarningsOverviewCardProps) {
  const { totalEarnings, pendingPayouts, recentIncome, currency = "USDC" } = data;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const calculateChange = () => {
    if (recentIncome.length < 2) return 0;
    const recent = recentIncome[recentIncome.length - 1];
    const previous = recentIncome[recentIncome.length - 2];
    if (previous === 0) return 0;
    return ((recent - previous) / previous) * 100;
  };

  const change = calculateChange();
  const isPositive = change >= 0;

  return (
    <GlassCard elevated className={`animate-fade-in ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-5 w-5 text-emerald-400" />
            <h2 className="text-zinc-400 text-sm font-medium">Total Earnings</h2>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-financial text-4xl text-zinc-100">
              {formatCurrency(totalEarnings)}
            </span>
            <span className="text-zinc-500 text-lg font-medium">{currency}</span>
          </div>
        </div>

        {/* Change Indicator */}
        {change !== 0 && (
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-lg ${
              isPositive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            <TrendingUp
              className={`h-4 w-4 ${!isPositive ? "rotate-180" : ""}`}
            />
            <span className="text-financial text-sm">
              {isPositive ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Sparkline */}
      <div className="mb-6">
        <SparklineChart data={recentIncome} width={300} height={48} />
      </div>

      {/* Pending Payouts */}
      <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-400" />
          <span className="text-zinc-400 text-sm">Pending Payouts</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-financial text-xl text-amber-400">
            {formatCurrency(pendingPayouts)}
          </span>
          <span className="text-zinc-500 text-sm">{currency}</span>
        </div>
      </div>
    </GlassCard>
  );
}
