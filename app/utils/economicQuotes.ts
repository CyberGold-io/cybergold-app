import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";
import { exactInputBasketMinimums, type UniversalExactInputQuote } from "./universalExactInput.ts";
import { QuotePreviewError, quoteResponseError } from "./quoteErrors.ts";
import { diagnosticAttemptId, diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { fetchQuoteStream } from "./quoteStream.ts";

export type EconomicRequest = components["schemas"]["EconomicRequest"];
export type EconomicPlan = components["schemas"]["EconomicPlan"];
export type EconomicQuote = components["schemas"]["EconomicQuote"];
export type EconomicQuoteEvent = components["schemas"]["EconomicQuoteEvent"];
export type AcceptedExecutionBounds = NonNullable<components["schemas"]["TransactionPreparationRequest"]["acceptedBounds"]>;
export type PreparedTransaction = components["schemas"]["PreparedTransaction"] & {
  plan: { body: Hex } };
export type SelectedExactInputQuote = EconomicQuote | (UniversalExactInputQuote & { economicQuote?: EconomicQuote });
export type EconomicQuoteScope = { chainId: number; configuration: string; generation?: string | null };

export function isEconomicQuote(value: SelectedExactInputQuote): value is EconomicQuote {
  return "request" in value && "conversions" in value.plan;
}

/** Legacy observations retain the exact guards already disclosed in their wire plan. */
export function legacyExecutionBounds(value: UniversalExactInputQuote): AcceptedExecutionBounds {
  const rows: { kind: number; token: string; id: string; minimumAmount: string }[] = [];
  if (value.plan.intent === 3) {
    rows.push(...exactInputBasketMinimums(value.plan).map(row => ({ ...row,
      id: row.id.toString(), minimumAmount: row.minimumAmount.toString() })));
  } else if (value.plan.intent === 1) {
    const body = value.planDescription as { branches?: { kind: number; data: { expectedOutputs?: typeof rows } }[] };
    for (const branch of body.branches ?? []) if (branch.kind === 0) rows.push(...branch.data.expectedOutputs ?? []);
  }
  return { inputs: value.plan.inputs.map(row => ({ ...row })), minimumOutput: value.plan.minimumOutput,
    ...(rows.length ? { expectedCoreOutputs: rows } : {}) };
}

/** Economic identity excludes head, wallet, execution tolerance and transport flags. */
export function economicRequest(input: EconomicRequest): EconomicRequest {
  return { intent: input.intent, inputs: input.inputs.map(row => ({ currency: row.currency.toLowerCase(),
    amount: BigInt(row.amount).toString() })), outputCurrency: input.outputCurrency.toLowerCase() };
}

export function economicQuoteKey(input: EconomicRequest, scope: EconomicQuoteScope) {
  return ["economic-quote", scope.chainId, scope.generation, scope.configuration, economicRequest(input)] as const;
}

async function quoteRequest<T>(path: string, body: unknown, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<T> {
  const attemptId = diagnosticAttemptId(), metadata = { attemptId, requestId: undefined as string | undefined };
  const response = await fetchImpl(path, { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", ...(attemptId ? { "X-CyberGold-Attempt-Id": attemptId } : {}) },
    body: JSON.stringify(body) }).catch(error => {
      if (signal?.aborted) throw error;
      throw new QuotePreviewError("quote-service-unavailable", "Quote service connection failed.", metadata);
    });
  metadata.requestId = response.headers.get("X-CyberGold-Request-Id") ?? undefined;
  if (!response.ok) { const error = await quoteResponseError(response); retainDiagnosticReferences(error, metadata); throw error; }
  const value: T = await response.json();
  retainDiagnosticReferences(value, { ...metadata, ...diagnosticReferences(value) });
  return value;
}

export function fetchEconomicQuote(request: EconomicRequest, signal?: AbortSignal, refresh = false,
  fetchImpl: typeof fetch = fetch): Promise<EconomicQuote> {
  return quoteRequest("/api/economic-quotes", { ...economicRequest(request), ...(refresh ? { refresh: true } : {}) }, signal, fetchImpl);
}

/** Canonical-ready whole quotes arrive before refinement finishes. JSON clients keep their endpoint. */
export function fetchEconomicQuoteStream(request: EconomicRequest, signal: AbortSignal,
  onEvent: (event: Extract<EconomicQuoteEvent, { type: "qualified" | "invalidated" | "upper-replay-settled" }>) => void,
  refresh = false, fetchImpl: typeof fetch = fetch): Promise<EconomicQuote> {
  return fetchQuoteStream<EconomicQuote, Extract<EconomicQuoteEvent, { type: "qualified" | "invalidated" | "upper-replay-settled" }>>(
    "/api/economic-quotes/stream", { ...economicRequest(request), ...(refresh ? { refresh: true } : {}) },
    signal, onEvent, fetchImpl);
}

export function fetchTxPreparation(quote: EconomicQuote, input: { sender: Address; recipient: Address; slippageBps?: number;
  acceptedBounds?: AcceptedExecutionBounds }, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<PreparedTransaction> {
  return quoteRequest("/api/tx-preparations", { quote, ...input }, signal, fetchImpl);
}

/** A measured display observation is retained until input changes or explicit Refresh. */
export function economicQuoteOptions(request: EconomicRequest, scope: EconomicQuoteScope, fetchImpl: typeof fetch = fetch) {
  return { queryKey: economicQuoteKey(request, scope), retry: false as const, staleTime: Infinity, gcTime: Infinity,
    refetchOnMount: false as const, refetchOnWindowFocus: false as const, refetchOnReconnect: false as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchEconomicQuote(request, signal, false, fetchImpl) };
}

/** A cleared/disproved cache slot is not a reusable observation on a revisit. */
export function progressiveEconomicQuoteOptions(request: EconomicRequest, scope: EconomicQuoteScope) {
  const cleared = (query: { state: { data: unknown } }) => query.state.data === null;
  return { ...economicQuoteOptions(request, scope), staleTime: (query: { state: { data: unknown } }) => cleared(query) ? 0 : Infinity,
    refetchOnMount: cleared };
}
