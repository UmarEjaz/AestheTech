/**
 * Centralized currency formatting using Intl.NumberFormat.
 *
 * Handles symbol placement, decimal places, and number grouping
 * automatically for all ~180 international currencies.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currencyCode: string): Intl.NumberFormat {
  let formatter = formatterCache.get(currencyCode);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    });
    formatterCache.set(currencyCode, formatter);
  }
  return formatter;
}

/**
 * Format a number as currency.
 *
 * Uses Intl.NumberFormat which automatically handles:
 * - Correct decimal places (2 for USD, 0 for JPY, 3 for BHD)
 * - Symbol placement (prefix/suffix)
 * - Number grouping (1,000 vs 1.000)
 *
 * @param amount  The numeric value to format
 * @param currencyCode  ISO 4217 currency code (e.g. "USD", "PKR", "JPY")
 * @returns Formatted string (e.g. "$1,234.56", "Rs 1,234.00", "¥1,234")
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return getFormatter(currencyCode).format(amount);
  } catch {
    // Fallback for invalid currency codes
    return `${amount.toFixed(2)}`;
  }
}

/**
 * Format currency for HTML contexts (emails).
 * Escapes HTML entities in the formatted string.
 */
export function formatCurrencyHtml(amount: number, currencyCode: string): string {
  return formatCurrency(amount, currencyCode)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
