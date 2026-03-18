/**
 * Centralized currency formatting using Intl.NumberFormat.
 *
 * Handles symbol placement, decimal places, and number grouping
 * automatically for all ~180 international currencies.
 */

const DEFAULT_LOCALE = "en-US";

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currencyCode: string, locale: string = DEFAULT_LOCALE): Intl.NumberFormat {
  const key = `${locale}:${currencyCode}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    });
    formatterCache.set(key, formatter);
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
 * @param locale  Optional BCP 47 locale (defaults to "en-US")
 * @returns Formatted string (e.g. "$1,234.56", "Rs 1,234.00", "¥1,234")
 */
export function formatCurrency(amount: number, currencyCode: string, locale?: string): string {
  try {
    return getFormatter(currencyCode, locale).format(amount);
  } catch {
    // Fallback for invalid currency codes
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/**
 * Format currency for HTML contexts (emails).
 * Escapes HTML entities in the formatted string.
 */
export function formatCurrencyHtml(amount: number, currencyCode: string, locale?: string): string {
  return formatCurrency(amount, currencyCode, locale)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Get the number of decimal places for a currency.
 * Uses Intl.NumberFormat to determine the correct decimals per ISO 4217.
 *
 * @example getCurrencyDecimals("USD") // 2
 * @example getCurrencyDecimals("JPY") // 0
 * @example getCurrencyDecimals("BHD") // 3
 */
export function getCurrencyDecimals(currencyCode: string): number {
  try {
    return getFormatter(currencyCode).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
