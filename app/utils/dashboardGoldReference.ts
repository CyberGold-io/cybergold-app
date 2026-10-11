const GRAMS_PER_TROY_OUNCE = 31.1034768;

/** A configured gold reference and its optional fiat equivalent, never a market price. */
export function dashboardGoldReference(
  grams: number | null | undefined,
  goldUsdPerOunce: number | null | undefined,
): { grams: number | null; usd: number | null } {
  if (grams == null || !Number.isFinite(grams) || grams <= 0) {
    return { grams: null, usd: null };
  }
  if (goldUsdPerOunce == null || !Number.isFinite(goldUsdPerOunce) || goldUsdPerOunce <= 0) {
    return { grams, usd: null };
  }
  const usd = grams / GRAMS_PER_TROY_OUNCE * goldUsdPerOunce;
  return { grams, usd: Number.isFinite(usd) ? usd : null };
}
