export type MarketDataFreshness = {
  fetchedAt?: string;
  isStale: boolean;
  isLoading?: boolean;
};

export type MarketDataFreshnessState = {
  gold?: MarketDataFreshness;
  fx?: MarketDataFreshness;
};

export function staleMarketDataFeedNames(
  state: MarketDataFreshnessState
): Array<"gold quote" | "FX rates"> {
  const names: Array<"gold quote" | "FX rates"> = [];
  if (state.gold?.fetchedAt && state.gold.isStale && !state.gold.isLoading) names.push("gold quote");
  if (state.fx?.fetchedAt && state.fx.isStale && !state.fx.isLoading) names.push("FX rates");
  return names;
}
