import { zeroAddress } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { QuoteIntentRequest } from "../../app/utils/quoteIntent.ts";
import type { TradeQuoteRequest } from "../../app/utils/tradeQuote.ts";

export type Scenario = {
  id: string; family: "issue-token" | "redeem-token" | "issue-basket" | "redeem-basket" | "market-buy" | "market-sell";
  requestedStrategy: "core" | "market"; inputMode: "exact-in" | "exact-out";
  side: "buy" | "sell"; asset: "PAXG" | "USDC" | "ETH" | "BASKET"; displayAmount: string;
};
export class ScenarioUnavailableError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** One inventory for independent producers, real wallet execution and UI selection. */
export const tradeScenarios: readonly Scenario[] = [
  ...(["PAXG", "USDC", "ETH"] as const).flatMap(asset => (["buy", "sell"] as const).flatMap(side =>
    (["exact-in", "exact-out"] as const).map(inputMode => ({
      id: `core-${side === "buy" ? "issue" : "redeem"}-${asset.toLowerCase()}-${inputMode}`,
      family: side === "buy" ? "issue-token" as const : "redeem-token" as const, requestedStrategy: "core" as const,
      side, inputMode, asset, displayAmount: side === "buy"
        ? inputMode === "exact-out" ? "0.25" : asset === "USDC" ? "20" : "0.01"
        : inputMode === "exact-in" ? "0.25" : asset === "USDC" ? "1" : asset === "ETH" ? "0.0001" : "0.002",
    })))),
  ...(["buy", "sell"] as const).flatMap(side => (["exact-in", "exact-out"] as const).map(inputMode => ({
    id: `core-${side === "buy" ? "issue" : "redeem"}-basket-${inputMode}`,
    family: side === "buy" ? "issue-basket" as const : "redeem-basket" as const,
    requestedStrategy: "core" as const, side, inputMode, asset: "BASKET" as const,
    displayAmount: (side === "buy") === (inputMode === "exact-in") ? "0.002" : "0.25",
  }))),
  ...(["buy", "sell"] as const).flatMap(side => (["exact-in", "exact-out"] as const).map(inputMode => ({
    id: `market-${side}-paxg-${inputMode}`, family: side === "buy" ? "market-buy" as const : "market-sell" as const,
    requestedStrategy: "market" as const, side, inputMode, asset: "PAXG" as const,
    displayAmount: (side === "buy") === (inputMode === "exact-in") ? "0.01" : "0.25",
  }))),
];

export function splitAmount(amount: bigint, weights: readonly bigint[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) throw new ScenarioUnavailableError("basket-weights-unavailable");
  let allocated = 0n;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1 ? amount - allocated : amount * weight / total;
    allocated += value; return value;
  });
}

/** Same weighted integer seed and direct-leg remainder as Backend core_request. */
export function coreIntentRequest(request: TradeQuoteRequest, adapter: string, assets: readonly string[], weights: readonly bigint[]): QuoteIntentRequest {
  const counter = request.counterToken, amount = BigInt(request.amount), buy = request.side === "buy", exactIn = request.mode === "exact-in";
  const targets: QuoteIntentRequest["targets"] = [];
  if ((buy && exactIn) || (!buy && !exactIn)) {
    const directIndex = assets.findIndex(asset => asset.toLowerCase() === counter.toLowerCase());
    let indices: number[], values: bigint[];
    if (directIndex < 0) {
      indices = weights.flatMap((weight, index) => buy && weight === 0n ? [] : [index]);
      values = splitAmount(amount, indices.map(index => weights[index]));
    } else {
      const total = weights.reduce((sum, weight) => sum + weight, 0n);
      if (!total) throw new ScenarioUnavailableError("basket-weights-unavailable");
      const direct = amount * weights[directIndex] / total;
      indices = weights.flatMap((weight, index) => index === directIndex || (buy && weight === 0n) ? [] : [index]);
      values = indices.some(index => weights[index] > 0n) ? splitAmount(amount - direct, indices.map(index => weights[index])) : indices.map(() => 0n);
      if (!buy && direct > 0n) targets.push({ inputAsset: assets[directIndex], outputAsset: counter, amount: String(direct) });
    }
    indices.forEach((index, position) => { if (values[position] > 0n) targets.push({
      inputAsset: buy ? counter : assets[index], outputAsset: buy ? assets[index] : counter, amount: String(values[position]),
    }); });
  }
  return { mode: `${buy ? "issue" : "redeem"}-${request.mode}`, token: request.native ? zeroAddress : counter,
    quoteToken: counter, native: request.native, amount: request.amount, adapter, deadline: request.deadline,
    orderedAssets: [...assets], targets, slippageBps: request.slippageBps ?? 100 };
}

export function configuredToken(config: ProtocolConfiguration, symbol: string) {
  const token = config.tokens.find(token => token.symbol.toUpperCase() === symbol.toUpperCase());
  if (!token) throw new ScenarioUnavailableError("token-unavailable");
  return token;
}

export function basketFacts(facts: ProtocolFacts) {
  if (facts.basket.assets.status !== "success") throw new ScenarioUnavailableError("basket-assets-unavailable");
  if (facts.basket.targetsPpm.status !== "success") throw new ScenarioUnavailableError("basket-weights-unavailable");
  return { assets: facts.basket.assets.value, weights: facts.basket.targetsPpm.value.map(BigInt) };
}
