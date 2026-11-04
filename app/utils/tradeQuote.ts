import type { Hex, Address } from "viem";
import type { components } from "../contracts/backend/http";
import type { ProtocolDeployment } from "./protocolConfiguration";
import type { UniversalExactInputQuote } from "./universalExactInput.ts";
import { fetchQuoteStream } from "./quoteStream.ts";
import { receiveMarketQuoteModel, receiveQuoteModel, receiveTradeBudgetRange } from "./quoteModelStore.ts";
import { diagnosticAttemptId, diagnosticReferences, retainDiagnosticReferences, safeDiagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";
import { isEconomicQuote, type EconomicQuote } from "./economicQuotes.ts";
import { applySlippageFloor } from "./swapPolicy.ts";
import { backendHttpMetadata, recordBackendHttpObservation, type BackendHttpObservation } from "./httpObservation.ts";

export type TradeQuoteRequest = components["schemas"]["TradeQuoteRequest"];
export type TradeQuote = components["schemas"]["TradeQuote"];
export type TradeQuoteEvent = components["schemas"]["TradeQuoteEvent"];
export type TradeModelRequest = components["schemas"]["TradeModelRequest"];
export type TradeQuoteModelPacket = components["schemas"]["TradeQuoteModelPacket"];
export type UniversalTradeQuote = UniversalExactInputQuote & { side: "buy" | "sell"; mode: "exact-in";
  quotedInput: string; inputMaximum: string; tokenIn: string; tokenOut: string; providerRequest: TradeQuoteRequest };
export type EconomicTradeQuote = EconomicQuote & { side: "buy" | "sell"; mode: "exact-in";
  quotedInput: string; inputMaximum: string; tokenIn: string; tokenOut: string;
  providerRequest: Omit<TradeQuoteRequest, "recipient" | "deadline" | "retainedPlan"> };
type WireTradeQuote = TradeQuote | components["schemas"]["UniversalExactInputQuote"];
export type ActiveTradeQuote = TradeQuote | UniversalTradeQuote | EconomicTradeQuote;
export type TradeQuoteResult<Value extends ActiveTradeQuote = ActiveTradeQuote> = {
  value: Value; deployment?: ProtocolDeployment;
  diagnostics?: DiagnosticReferences;
  quotedInput: bigint; quotedOutput: bigint; inputMaximum: bigint; outputMinimum: bigint;
};

export function tradeQuoteResult<Value extends ActiveTradeQuote>(value: Value, slippageBps?: number): TradeQuoteResult<Value> {
  return { value, diagnostics: diagnosticReferences(value), quotedInput: BigInt(value.quotedInput), quotedOutput: BigInt(value.quotedOutput),
    inputMaximum: BigInt(value.inputMaximum), outputMinimum: value.strategy === "universal" && isEconomicQuote(value)
      ? applySlippageFloor(BigInt(value.quotedOutput), slippageBps) : BigInt(value.outputMinimum) };
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
  const captured = structuredClone(value.value); retainDiagnosticReferences(captured, diagnosticReferences(value.value));
  return { ...value, value: captured, diagnostics: value.diagnostics && { ...value.diagnostics }, deployment: value.deployment && { ...value.deployment } };
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
  const value = await fetchQuoteStream<WireTradeQuote, Exclude<TradeQuoteEvent, { type: "complete" } | { type: "error" }>>(
    "/api/quotes/trade/stream", request, signal, onEvent, fetchImpl);
  return tradeQuoteResult(normalizedTradeQuote(value, request));
}

export async function fetchTradeModel(request: TradeModelRequest, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch, existingAttemptId?: string): Promise<TradeQuoteModelPacket> {
  const started = performance.now();
  const metadata = safeDiagnosticReferences({ attemptId: existingAttemptId ?? diagnosticAttemptId() });
  let headersAt: number | undefined, response: Response | undefined;
  const observe = (value: unknown, outcome: BackendHttpObservation["outcome"]) => {
    const completed = performance.now();
    recordBackendHttpObservation(value, { operation: "economic-estimates", outcome, ...metadata,
      ...(response ? { ...backendHttpMetadata(response.headers), httpStatus: response.status } : {}),
      elapsedMs: completed - started,
      ...(headersAt !== undefined ? { headersMs: headersAt - started, bodyMs: completed - headersAt } : {}) });
  };
  try {
    response = await fetchImpl("/api/economic-estimates", { method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", ...(metadata.attemptId ? { "X-CyberGold-Attempt-Id": metadata.attemptId } : {}) },
      body: JSON.stringify(request) });
    headersAt = performance.now();
    Object.assign(metadata, safeDiagnosticReferences({ requestId: response.headers.get("X-CyberGold-Request-Id") }));
    if (!response.ok) throw new Error("Trading estimates are temporarily unavailable.");
    const value: TradeQuoteModelPacket = await response.json();
    observe(value, "succeeded"); return value;
  } catch (error) {
    observe(error, signal?.aborted ? "cancelled" : "failed"); throw error;
  }
}

export function economicTradeQuote(quote: EconomicQuote, request: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">): EconomicTradeQuote {
  const intent = { side: request.side, mode: request.mode, counterToken: request.counterToken,
    native: request.native, amount: request.amount, slippageBps: request.slippageBps };
  const value: EconomicTradeQuote = { ...quote, quotedInput: quote.quotedInput ?? quote.inputs[0].amount, inputMaximum: quote.inputMaximum ?? quote.inputs[0].amount,
    side: request.side, mode: "exact-in", tokenIn: quote.inputs[0].currency,
    tokenOut: quote.request.outputCurrency, providerRequest: intent };
  retainDiagnosticReferences(value, diagnosticReferences(quote)); return value;
}
