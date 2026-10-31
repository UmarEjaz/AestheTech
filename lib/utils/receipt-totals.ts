/**
 * Value of loyalty points redeemed at checkout, derived from the printed figures. Checkout lowers the
 * document total by the points value (before tax) but leaves Subtotal and Discount untouched, so the
 * gap `(Subtotal − Discount + Tax) − Total` is exactly that value. Deriving it (rather than re-reading
 * the points balance) keeps any receipt or invoice footing — Subtotal − Discount − Loyalty + Tax = Total
 * — and stays correct even if the salon's points rate changes later. Returns 0 when no points were used.
 */
export function impliedLoyaltyValue(totals: {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}): number {
  const gap = Math.round((totals.subtotal - totals.discount + totals.tax - totals.total) * 100) / 100;
  return gap > 0 ? gap : 0;
}
