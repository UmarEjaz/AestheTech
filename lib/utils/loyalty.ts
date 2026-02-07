import { LoyaltyTier } from "@prisma/client";

export interface TierThresholds {
  goldThreshold: number;
  platinumThreshold: number;
}

export interface TierMultipliers {
  silverMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
}

export function calculateTier(balance: number, thresholds: TierThresholds): LoyaltyTier {
  if (balance >= thresholds.platinumThreshold) return "PLATINUM";
  if (balance >= thresholds.goldThreshold) return "GOLD";
  return "SILVER";
}

export function getTierMultiplier(tier: LoyaltyTier, multipliers: TierMultipliers): number {
  switch (tier) {
    case "PLATINUM":
      return multipliers.platinumMultiplier;
    case "GOLD":
      return multipliers.goldMultiplier;
    case "SILVER":
      return multipliers.silverMultiplier;
  }
}

export function getNextTier(tier: LoyaltyTier): LoyaltyTier | null {
  switch (tier) {
    case "SILVER":
      return "GOLD";
    case "GOLD":
      return "PLATINUM";
    case "PLATINUM":
      return null;
  }
}

export function getPointsToNextTier(
  balance: number,
  tier: LoyaltyTier,
  thresholds: TierThresholds
): number | null {
  switch (tier) {
    case "SILVER":
      return thresholds.goldThreshold - balance;
    case "GOLD":
      return thresholds.platinumThreshold - balance;
    case "PLATINUM":
      return null;
  }
}

/**
 * Returns progress percentage (0-100) toward the next tier.
 * PLATINUM clients always return 100.
 */
export function getTierProgress(
  balance: number,
  tier: LoyaltyTier,
  thresholds: TierThresholds
): number {
  switch (tier) {
    case "SILVER": {
      const range = thresholds.goldThreshold;
      return range > 0 ? Math.min(100, Math.round((balance / range) * 100)) : 100;
    }
    case "GOLD": {
      const rangeStart = thresholds.goldThreshold;
      const rangeEnd = thresholds.platinumThreshold;
      const range = rangeEnd - rangeStart;
      return range > 0
        ? Math.min(100, Math.round(((balance - rangeStart) / range) * 100))
        : 100;
    }
    case "PLATINUM":
      return 100;
  }
}
