import { LoyaltyTier, LoyaltyTransactionType } from "@prisma/client";

export interface TierThresholds {
  goldThreshold: number;
  platinumThreshold: number;
}

export interface TierMultipliers {
  silverMultiplier: number;
  goldMultiplier: number;
  platinumMultiplier: number;
}

/** Returns the loyalty tier for a given point balance based on configured thresholds. */
export function calculateTier(balance: number, thresholds: TierThresholds): LoyaltyTier {
  if (balance >= thresholds.platinumThreshold) return "PLATINUM";
  if (balance >= thresholds.goldThreshold) return "GOLD";
  return "SILVER";
}

/** Returns the points earning multiplier for the given tier. */
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

/** Returns the next tier above the current one, or null if already at PLATINUM. */
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

/** Returns the number of points needed to reach the next tier, or null if at PLATINUM. */
export function getPointsToNextTier(
  balance: number,
  tier: LoyaltyTier,
  thresholds: TierThresholds
): number | null {
  switch (tier) {
    case "SILVER":
      return Math.max(0, thresholds.goldThreshold - balance);
    case "GOLD":
      return Math.max(0, thresholds.platinumThreshold - balance);
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

/**
 * Checks if today is the client's birthday (month + day match).
 * Uses UTC for both to avoid timezone inconsistencies — birthdays are
 * stored as midnight UTC from the date picker.
 */
export function isBirthday(birthday: Date | null | undefined): boolean {
  if (!birthday) return false;
  const today = new Date();
  const bday = new Date(birthday);
  return today.getUTCMonth() === bday.getUTCMonth() && today.getUTCDate() === bday.getUTCDate();
}

/**
 * Checks if a BONUS transaction with "Birthday bonus {year}" already exists this year.
 */
export function hasReceivedBirthdayBonusThisYear(
  transactions: { type: LoyaltyTransactionType; description: string | null }[]
): boolean {
  const year = new Date().getFullYear();
  return transactions.some(
    (t) => t.type === "BONUS" && t.description === `Birthday bonus ${year}`
  );
}

/**
 * Calculates aggregate loyalty stats from transaction history.
 */
export function calculateLoyaltyStats(
  transactions: { type: LoyaltyTransactionType; points: number }[]
): {
  totalEarned: number;
  totalRedeemed: number;
  totalExpired: number;
  totalBonus: number;
  totalAdjustment: number;
} {
  let totalEarned = 0;
  let totalRedeemed = 0;
  let totalExpired = 0;
  let totalBonus = 0;
  let totalAdjustment = 0;

  for (const t of transactions) {
    switch (t.type) {
      case "EARNED":
        totalEarned += t.points;
        break;
      case "REDEEMED":
        totalRedeemed += Math.abs(t.points);
        break;
      case "EXPIRED":
        totalExpired += Math.abs(t.points);
        break;
      case "BONUS":
        totalBonus += t.points;
        break;
      case "ADJUSTMENT":
        totalAdjustment += t.points;
        break;
    }
  }

  return { totalEarned, totalRedeemed, totalExpired, totalBonus, totalAdjustment };
}
