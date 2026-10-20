import { zeroAddress, type Hex, type Address } from "viem";
import type { components } from "../contracts/backend/http";
import type { ProtocolDeployment } from "./protocolConfiguration";
import { fetchUniversalExactInputQuote, type UniversalExactInputQuote } from "./universalExactInput.ts";
import { fetchQuoteStream } from "./quoteStream.ts";
import { receiveMarketQuoteModel, receiveQuoteModel } from "./quoteModelStore.ts";
import { diagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";

export type TradeQuoteRequest = components["schemas"]["TradeQuoteRequest"];
export type TradeQuote = components["schemas"]["TradeQuote"];
export type TradeQuoteEvent = components["schemas"]["TradeQuoteEvent"];
export type TradeModelRequest = components["schemas"]["TradeModelRequest"];
export type TradeQuoteModelPacket = components["schemas"]["TradeQuoteModelPacket"];
export type UniversalTradeQuote = UniversalExactInputQuote & { side: "buy" | "sell"; mode: "exact-in";
  quotedInput: string; inputMaximum: string; tokenIn: string; tokenOut: string; providerRequest: TradeQuoteRequest };
type WireTradeQuote = TradeQuote | components["schemas"]["UniversalExactInputQuote"];
export type ActiveTradeQuote = TradeQuote | UniversalTradeQuote;
export type TradeQuoteResult<Value extends ActiveTradeQuote = ActiveTradeQuote> = {
  value: Value; deployment?: ProtocolDeployment;
  diagnostics?: DiagnosticReferences;
  quotedInput: bigint; quotedOutput: bigint; inputMaximum: bigint; outputMinimum: bigint;
};

export function tradeQuoteResult<Value extends ActiveTradeQuote>(value: Value): TradeQuoteResult<Value> {
  return { value, diagnostics: diagnosticReferences(value), quotedInput: BigInt(value.quotedInput), quotedOutput: BigInt(value.quotedOutput),
    inputMaximum: BigInt(value.inputMaximum), outputMinimum: BigInt(value.outputMinimum) };
}

/** Normalize the producer's canonical universal winner without re-quoting it. */
export function normalizedTradeQuote(value: WireTradeQuote, request: TradeQuoteRequest): ActiveTradeQuote {
  if (value.strategy !== "universal") return value;
  return { ...value, plan: { ...value.plan, body: value.plan.body as Hex },
    quotedInput: value.quotedInput!, inputMaximum: value.inputMaximum!, side: request.side, mode: "exact-in",
    tokenIn: value.inputs[0].currency, tokenOut: value.plan.outputCurrency, providerRequest: request };
}

export function tradeAdapter(value: ActiveTradeQuote): Address | undefined {
  if (value.strategy === "universal") return value.deployment.adapter as Address;
  if (value.strategy === "market") return value.providerQuote.params.adapter as Address;
  return value.providerQuote.quotes[0]?.adapter as Address | undefined;
}

/** Capture the accepted complete plan before any wallet or other asynchronous work. */
export function captureTradeQuote<Value extends ActiveTradeQuote>(value: TradeQuoteResult<Value>): TradeQuoteResult<Value> {
  return { ...tradeQuoteResult(structuredClone(value.value)), diagnostics: value.diagnostics && { ...value.diagnostics }, deployment: value.deployment && { ...value.deployment } };
}

/** Refresh observations without replacing the selected economic tuple. */
export function withTradeProviderEvent<Value extends ActiveTradeQuote>(value: Value,
  event: Extract<TradeQuoteEvent, { type: "provider-qualified" | "provider-assessment" }>): Value {
  if (value.strategy === "universal") return value;
  const providerCandidates: Partial<Record<"core" | "market", components["schemas"]["TradeProviderCandidate"]>> = { ...value.providerCandidates };
  if (event.type === "provider-qualified") {
    providerCandidates[event.strategy] = structuredClone(event.value);
    return { ...value, providerCandidates } as Value;
  }
  if (event.value.availability !== "qualified") delete providerCandidates[event.strategy];
  return { ...value, providerCandidates,
    providerAssessments: { ...value.providerAssessments, [event.strategy]: structuredClone(event.value) } } as Value;
}

export function retainedTradePlan(value: TradeQuoteResult<TradeQuote>): NonNullable<TradeQuoteRequest["retainedPlan"]> {
  const selected = value.value;
  return selected.strategy === "core"
    ? { strategy: "core", request: selected.providerRequest, quote: selected.providerQuote }
    : { strategy: "market", request: selected.providerRequest, quote: selected.providerQuote };
}

/** Preserve each producer's model identity; only Backend supplies the winning estimate. */
export function receiveTradeModel(packet: TradeQuoteModelPacket, scope: string) {
  for (const model of packet.models) {
    if (model.strategy === "core") receiveQuoteModel(model.value, undefined, scope);
    else receiveMarketQuoteModel(model.value, scope);
  }
}

export async function fetchTradeQuote(request: TradeQuoteRequest, signal: AbortSignal,
  onEvent: (event: Exclude<TradeQuoteEvent, { type: "complete" } | { type: "error" }>) => void,
  fetchImpl: typeof fetch = fetch): Promise<TradeQuoteResult> {
  const value = await fetchQuoteStream<WireTradeQuote, Exclude<TradeQuoteEvent, { type: "complete" } | { type: "error" }>>(
    "/api/quotes/trade/stream", request, signal, onEvent, fetchImpl);
  return tradeQuoteResult(normalizedTradeQuote(value, request));
}

export async function fetchTradeModel(request: TradeModelRequest, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<TradeQuoteModelPacket> {
  const response = await fetchImpl("/api/quotes/trade/model", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Trading estimates are temporarily unavailable.");
  return response.json();
}

/** Scalar input-only journeys use the same typed plan as basket journeys. */
export async function fetchUniversalTradeQuote(request: TradeQuoteRequest, core: Address, signal: AbortSignal): Promise<TradeQuoteResult<UniversalTradeQuote>> {
  const counter = request.native ? zeroAddress : request.counterToken;
  const tokenIn = request.side === "buy" ? counter : core, tokenOut = request.side === "buy" ? core : counter;
  const quote = await fetchUniversalExactInputQuote({ intent: request.side === "buy" ? 0 : 1,
    inputs: [{ currency: tokenIn, amount: request.amount }], outputCurrency: tokenOut,
    recipient: request.recipient, deadline: request.deadline, slippageBps: request.slippageBps }, signal);
  return tradeQuoteResult({ ...quote, quotedInput: quote.quotedInput!, inputMaximum: quote.inputMaximum!, side: request.side, mode: "exact-in", tokenIn, tokenOut, providerRequest: request });
}
