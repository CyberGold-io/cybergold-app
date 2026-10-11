import type { MarketQuoteModelPacket, MarketModelRequest } from "./marketQuote.ts";
import { predictLeg } from "./quoteModels.ts";

const ppm = 1_000_000n;
const ceil = (amount: bigint, denominator: bigint) => (amount + denominator - 1n) / denominator;

/** Display arithmetic consumes the Backend rate; it defines no pricing policy. */
export function predictMarketModel(packet: MarketQuoteModelPacket, amount: bigint): bigint | undefined {
  if (amount <= 0n) return undefined;
  try {
    const rate = BigInt(packet.feeRatePpm), exactInput = packet.intent.mode === "exact-in";
    const buy = packet.intent.side === "buy";
    const raw = !buy && exactInput ? amount * ppm / (ppm + rate)
      : buy && !exactInput ? ceil(amount * ppm, ppm - rate) : amount;
    const results = packet.routes.flatMap(row => {
      const predicted = predictLeg({
        points: row.points.map(point => ({ input: point.amountIn, output: point.amountOut })),
        exchangeRate: row.feeRetention ? row.exchangeRate : undefined,
        feeRetention: row.feeRetention ?? { numerator: "1", denominator: "1" }, localImpact: row.localImpact,
      }, raw, !exactInput);
      if (predicted === undefined) return [];
      const fee = ceil(predicted * rate, ppm);
      return [buy && exactInput ? predicted - fee : !buy && !exactInput ? predicted + fee : predicted];
    });
    return results.reduce<bigint | undefined>((best, value) => best === undefined
      || (exactInput ? value > best : value < best) ? value : best, undefined);
  } catch { return undefined; }
}

export async function fetchMarketModel(request: MarketModelRequest, signal: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<MarketQuoteModelPacket> {
  const response = await fetchImpl("/api/quotes/market/model", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Market estimates are temporarily unavailable.");
  return response.json();
}
