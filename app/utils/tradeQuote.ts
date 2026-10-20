import type { Address } from "viem";
import type { components } from "../contracts/backend/http";
import type { ProtocolDeployment } from "./protocolConfiguration";
import { fetchQuoteStream } from "./quoteStream.ts";
import { receiveMarketQuoteModel, receiveQuoteModel, receiveTradeBudgetRange } from "./quoteModelStore.ts";
import { diagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";

export type TradeQuoteRequest = components["schemas"]["TradeQuoteRequest"];
export type TradeQuote = components["schemas"]["TradeQuote"];
export type TradeQuoteEvent = components["schemas"]["TradeQuoteEvent"];
export type TradeModelRequest = components["schemas"]["TradeModelRequest"];
export type TradeQuoteModelPacket = components["schemas"]["TradeQuoteModelPacket"];
export type TradeQuoteResult<Value extends TradeQuote = TradeQuote> = {
  value: Value; deployment?: ProtocolDeployment;
  diagnostics?: DiagnosticReferences;
  quotedInput: bigint; quotedOutput: bigint; inputMaximum: bigint; outputMinimum: bigint;
};

export function tradeQuoteResult<Value extends TradeQuote>(value: Value): TradeQuoteResult<Value> {
  return { value, diagnostics: diagnosticReferences(value), quotedInput: BigInt(value.quotedInput), quotedOutput: BigInt(value.quotedOutput),
    inputMaximum: BigInt(value.inputMaximum), outputMinimum: BigInt(value.outputMinimum) };
}

export function tradeAdapter(value: TradeQuote): Address | undefined {
  if (value.strategy === "market") return value.providerQuote.params.adapter as Address;
  return value.providerQuote.quotes[0]?.adapter as Address | undefined;
}

/** Capture the accepted complete plan before any wallet or other asynchronous work. */
export function captureTradeQuote<Value extends TradeQuote>(value: TradeQuoteResult<Value>): TradeQuoteResult<Value> {
  return { ...tradeQuoteResult(structuredClone(value.value)), diagnostics: value.diagnostics && { ...value.diagnostics }, deployment: value.deployment && { ...value.deployment } };
}

/** Refresh observations without replacing the selected economic tuple. */
export function withTradeProviderEvent(value: TradeQuote,
  event: Extract<TradeQuoteEvent, { type: "provider-qualified" | "provider-assessment" }>): TradeQuote {
  const providerCandidates: Partial<Record<"core" | "market", components["schemas"]["TradeProviderCandidate"]>> = { ...value.providerCandidates };
  if (event.type === "provider-qualified") {
    providerCandidates[event.strategy] = structuredClone(event.value);
    return { ...value, providerCandidates } as TradeQuote;
  }
  if (event.value.availability !== "qualified") delete providerCandidates[event.strategy];
  return { ...value, providerCandidates,
    providerAssessments: { ...value.providerAssessments, [event.strategy]: structuredClone(event.value) } } as TradeQuote;
}

export function retainedTradePlan(value: TradeQuoteResult): NonNullable<TradeQuoteRequest["retainedPlan"]> {
  const selected = value.value;
  return selected.strategy === "core"
    ? { strategy: "core", request: selected.providerRequest, quote: selected.providerQuote }
    : { strategy: "market", request: selected.providerRequest, quote: selected.providerQuote };
}

/** Preserve each producer's model identity; only Backend supplies the winning estimate. */
export function receiveTradeModel(packet: TradeQuoteModelPacket, scope: string, displayScope = scope) {
  for (const model of packet.models) {
    if (model.strategy === "core") receiveQuoteModel(model.value, undefined, scope);
    else receiveMarketQuoteModel(model.value, scope);
  }
  receiveTradeBudgetRange(packet, displayScope);
}

export async function fetchTradeQuote(request: TradeQuoteRequest, signal: AbortSignal,
  onEvent: (event: Exclude<TradeQuoteEvent, { type: "complete" } | { type: "error" }>) => void,
  fetchImpl: typeof fetch = fetch): Promise<TradeQuoteResult> {
  const value = await fetchQuoteStream<TradeQuote, Exclude<TradeQuoteEvent, { type: "complete" } | { type: "error" }>>(
    "/api/quotes/trade/stream", request, signal, onEvent, fetchImpl);
  return tradeQuoteResult(value);
}

export async function fetchTradeModel(request: TradeModelRequest, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<TradeQuoteModelPacket> {
  const response = await fetchImpl("/api/quotes/trade/model", { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Trading estimates are temporarily unavailable.");
  return response.json();
}
