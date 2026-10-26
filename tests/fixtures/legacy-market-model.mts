import type { MarketQuoteModelPacket, MarketModelRequest } from "../../app/utils/marketQuote.ts";

/** Historical model-transport control; active display uses /api/economic-estimates. */
export async function fetchMarketModel(request: MarketModelRequest, signal: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<MarketQuoteModelPacket> {
  const response = await fetchImpl("/api/quotes/market/model", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Market estimates are temporarily unavailable.");
  return response.json();
}
