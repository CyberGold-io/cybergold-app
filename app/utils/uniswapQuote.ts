import type { components } from "../contracts/backend/http";

export type UniswapQuoteRequest = components["schemas"]["UniswapQuoteRequest"];
type UniswapQuote = components["schemas"]["UniswapQuote"];

export async function fetchUniswapQuote(
  request: UniswapQuoteRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<bigint> {
  const response = await fetchImpl("/api/quotes/uniswap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("Uniswap quotes are temporarily unavailable.");
  const value: UniswapQuote = await response.json();
  return BigInt(value.result.amount);
}
