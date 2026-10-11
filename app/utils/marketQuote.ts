import type { ProtocolDeployment } from "./protocolConfiguration";
import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";
import { fetchQuoteStream } from "./quoteStream.ts";

export type MarketQuoteRequest = components["schemas"]["MarketQuoteRequest"];
export type MarketQuote = components["schemas"]["MarketQuote"];
export type MarketQuoteEvent = components["schemas"]["MarketQuoteEvent"];
export type MarketQuoteModelPacket = components["schemas"]["MarketQuoteModelPacket"];
export type MarketModelRequest = components["schemas"]["MarketModelRequest"];
export type MarketRoutePlan = MarketQuote["plan"]["route"];
export type MarketSwapParams = {
  side: 0 | 1; counterToken: Address; amount: bigint; bound: bigint; routedInput: bigint;
  feeCygld: bigint; recipient: Address; deadline: bigint; adapter: Address; data: Hex;
};
export type MarketQuoteResult = {
  deployment?: ProtocolDeployment;
  value: MarketQuote; params: MarketSwapParams;
  totalInput: bigint; netOutput: bigint; grossOutput: bigint; routedAmountIn: bigint;
  inputMaximum: bigint; outputMinimum: bigint; refundDust: bigint; feeCygld: bigint;
};

/** Wire integers remain raw units, including amounts larger than Number can hold. */
export function marketQuoteResult(value: MarketQuote): MarketQuoteResult {
  const p = value.params;
  return { value, params: { side: p.side, counterToken: p.counterToken as Address,
    amount: BigInt(p.amount), bound: BigInt(p.bound), routedInput: BigInt(p.routedInput),
    feeCygld: BigInt(p.feeCygld), recipient: p.recipient as Address, deadline: BigInt(p.deadline),
    adapter: p.adapter as Address, data: p.data as Hex },
    totalInput: BigInt(value.totalInput), netOutput: BigInt(value.netOutput), grossOutput: BigInt(value.grossOutput),
    routedAmountIn: BigInt(value.routedAmountIn), inputMaximum: BigInt(value.inputMaximum),
    outputMinimum: BigInt(value.outputMinimum), refundDust: BigInt(value.refundDust), feeCygld: BigInt(value.fee.amount) };
}

export function preferMarketQuote(current: MarketQuoteResult | undefined, candidate: MarketQuoteResult): MarketQuoteResult {
  if (!current) return candidate;
  if (candidate.value.mode !== current.value.mode || candidate.value.side !== current.value.side) return candidate;
  const improves = candidate.value.mode === "exact-in"
    ? candidate.totalInput <= current.totalInput && candidate.netOutput >= current.netOutput
    : candidate.netOutput === current.netOutput && candidate.totalInput <= current.totalInput;
  return improves ? candidate : current;
}

/** Shared producer key; market identity never includes Core basket fields. */
export function marketModelFamily(input: Pick<MarketQuoteRequest, "side" | "mode" | "counterToken" | "adapter">): string {
  return JSON.stringify(["market", input.side, input.mode, input.counterToken.toLowerCase(), (input.adapter ?? "").toLowerCase()]);
}

export async function fetchMarketQuote(request: MarketQuoteRequest, signal: AbortSignal,
  onEvent: (event: Exclude<MarketQuoteEvent, { type: "error" }>) => void, fetchImpl: typeof fetch = fetch,
): Promise<MarketQuoteResult> {
  const value = await fetchQuoteStream<MarketQuote, Exclude<MarketQuoteEvent, { type: "error" }>>(
    "/api/quotes/market/stream", request, signal, onEvent, fetchImpl,
  );
  return marketQuoteResult(value);
}

export function marketRouteProtocols(plan: MarketRoutePlan): string[] {
  return [...new Set(plan.branches.flatMap(branch => branch.hops.map(hop => hop.pool.protocol)))];
}
