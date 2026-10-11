import type { ProtocolDeployment } from "./protocolConfiguration";
import type { components } from "../contracts/backend/http";
import type { CoreTokenAmount, CoreTokenMinimum, HelperFees, RoutedSwapFromQuote, SwapToQuote } from "../types";
import { applySlippageFloor, DEFAULT_SLIPPAGE_BPS } from "./swapPolicy.ts";
import { fetchQuoteStream } from "./quoteStream.ts";

export type QuoteIntentRequest = components["schemas"]["QuoteIntentRequest"];
export type QuoteIntentEvent = components["schemas"]["QuoteIntentEvent"];
export type QuoteIntent = components["schemas"]["QuoteIntent"];
export type QuoteIntentResult = {
  deployment?: ProtocolDeployment;
  context: QuoteIntent["context"]; metrics: QuoteIntent["metrics"];
  quotes: SwapToQuote[]; redemptionQuotes: RoutedSwapFromQuote[];
  displayAmount: bigint; executionAmount: bigint; maximumInputAmount: bigint;
  slippageBps: number; expectedInputAmount?: bigint;
  requestedGrossCygldOut?: bigint; requestedNetCygldOut?: bigint;
  remainingGrossCapacity?: bigint; remainingNetCapacity?: bigint;
  fees: HelperFees; initialFees?: HelperFees; orderedCoreAssets?: `0x${string}`[];
  projectedCoreOutputs?: CoreTokenAmount[]; quotedAmountOut?: bigint;
  expectedCoreOutputs?: CoreTokenMinimum[];
};
const fees = (value: { protocolFeeCygld: string; helperFeeCygld: string }): HelperFees => ({
  protocolFeeCygld: BigInt(value.protocolFeeCygld), helperFeeCygld: BigInt(value.helperFeeCygld),
});

export function quoteIntentResult(value: QuoteIntent, slippageBps = DEFAULT_SLIPPAGE_BPS): QuoteIntentResult {
  const tolerance = value.slippageBps ?? slippageBps;
  return {
    context: value.context, metrics: value.metrics,
    displayAmount: BigInt(value.displayAmount), executionAmount: BigInt(value.executionAmount),
    maximumInputAmount: BigInt(value.maximumInputAmount), fees: fees(value.preview.fees),
    slippageBps: tolerance,
    expectedInputAmount: value.expectedInputAmount == null ? undefined : BigInt(value.expectedInputAmount),
    requestedGrossCygldOut: value.requestedGrossCygldOut == null ? undefined : BigInt(value.requestedGrossCygldOut),
    requestedNetCygldOut: value.requestedNetCygldOut == null ? undefined : BigInt(value.requestedNetCygldOut),
    remainingGrossCapacity: value.remainingGrossCapacity == null ? undefined : BigInt(value.remainingGrossCapacity),
    remainingNetCapacity: value.remainingNetCapacity == null ? undefined : BigInt(value.remainingNetCapacity),
    initialFees: value.initialPreview ? fees(value.initialPreview.fees) : undefined,
    orderedCoreAssets: "orderedCoreAssets" in value.preview ? value.preview.orderedCoreAssets as `0x${string}`[] : undefined,
    projectedCoreOutputs: "projectedCoreOutputs" in value.preview ? value.preview.projectedCoreOutputs.map(row => ({
      kind: row.kind as CoreTokenAmount["kind"], token: row.token as `0x${string}`,
      id: BigInt(row.id), amount: BigInt(row.amount),
    })) : undefined,
    expectedCoreOutputs: value.expectedCoreOutputs ? value.expectedCoreOutputs.map(row => ({
      kind: row.kind as CoreTokenMinimum["kind"], token: row.token as `0x${string}`,
      id: BigInt(row.id), minimumAmount: BigInt(row.minimumAmount),
    }))
      : "projectedCoreOutputs" in value.preview ? value.preview.projectedCoreOutputs.map(row => ({
      kind: row.kind as CoreTokenMinimum["kind"], token: row.token as `0x${string}`,
      id: BigInt(row.id), minimumAmount: applySlippageFloor(BigInt(row.amount), tolerance),
    })) : undefined,
    quotedAmountOut: "minimumAmountOut" in value.preview ? BigInt(value.preview.minimumAmountOut) : undefined,
    quotes: value.quotes.flatMap(row => "amountIn" in row ? [{
      ...row, adapter: row.adapter as `0x${string}`, outputAsset: row.outputAsset as `0x${string}`,
      amountIn: BigInt(row.amountIn), minimumAmountOut: BigInt(row.minimumAmountOut), data: row.data as `0x${string}`,
    }] : []),
    redemptionQuotes: value.quotes.flatMap(row => "inputAmount" in row ? [{
      ...row, adapter: row.adapter as `0x${string}`, inputAsset: row.inputAsset as `0x${string}`,
      inputAmount: BigInt(row.inputAmount), minimumAmountOut: BigInt(row.minimumAmountOut), data: row.data as `0x${string}`,
    }] : []),
  };
}

export function retainedQuotePlan(value: QuoteIntentResult): NonNullable<QuoteIntentRequest["retainedPlan"]> {
  return {
    slippageBps: value.slippageBps,
    expectedInputAmount: value.expectedInputAmount === undefined ? undefined : String(value.expectedInputAmount),
    executionAmount: String(value.executionAmount), maximumInputAmount: String(value.maximumInputAmount),
    minimumAmountOut: String(value.quotedAmountOut ?? 0n),
    quotes: [...value.quotes.map(row => ({ ...row, amountIn: String(row.amountIn), minimumAmountOut: String(row.minimumAmountOut) })),
      ...value.redemptionQuotes.map(row => ({ ...row, inputAmount: String(row.inputAmount), minimumAmountOut: String(row.minimumAmountOut) }))],
    expectedCoreOutputs: (value.expectedCoreOutputs ?? []).map(row => ({ ...row, id: String(row.id), minimumAmount: String(row.minimumAmount) })),
  };
}

/** Replace the complete tuple together, only with a non-worse checked plan. */
export function preferQuoteIntent(mode: QuoteIntentRequest["mode"], current: QuoteIntentResult | undefined,
  candidate: QuoteIntentResult): QuoteIntentResult {
  if (!current || current.slippageBps !== candidate.slippageBps) return candidate;
  const improves = mode === "issue-exact-in" ? candidate.executionAmount >= current.executionAmount
    && candidate.maximumInputAmount <= current.maximumInputAmount
    : mode === "issue-exact-out" ? candidate.executionAmount === current.executionAmount
      && candidate.maximumInputAmount <= current.maximumInputAmount
    : mode === "redeem-exact-in" ? candidate.executionAmount === current.executionAmount
      && (candidate.quotedAmountOut ?? 0n) >= (current.quotedAmountOut ?? 0n)
    : candidate.executionAmount <= current.executionAmount;
  if (!improves) return current;
  if (mode === "redeem-exact-in" && current.expectedCoreOutputs) {
    const outputs = candidate.projectedCoreOutputs ?? [];
    if (outputs.length !== current.expectedCoreOutputs.length || current.expectedCoreOutputs.some(bound =>
      !outputs.some(output => output.kind === bound.kind && output.token.toLowerCase() === bound.token.toLowerCase()
        && output.id === bound.id && output.amount >= bound.minimumAmount))) return current;
    // The original settlement protection survives repeated head validation.
    return { ...candidate, expectedCoreOutputs: current.expectedCoreOutputs };
  }
  return candidate;
}

export async function fetchQuoteIntent(request: QuoteIntentRequest, signal: AbortSignal,
  onEvent: (event: Exclude<QuoteIntentEvent, { type: "complete" } | { type: "error" }>) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteIntentResult> {
  const value = await fetchQuoteStream<QuoteIntent, Exclude<QuoteIntentEvent, { type: "complete" } | { type: "error" }>>(
    "/api/quotes/intent/stream", request, signal, onEvent, fetchImpl,
  );
  return quoteIntentResult(value, request.slippageBps);
}
