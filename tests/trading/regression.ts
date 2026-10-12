import { parseUnits, zeroAddress } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { BasketPreview, BasketPreviewRequest } from "../../app/utils/basketPreview.ts";
import type { QuoteIntent } from "../../app/utils/quoteIntent.ts";
import type { MarketQuote } from "../../app/utils/marketQuote.ts";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote.ts";
import { fetchQuoteStream } from "../../app/utils/quoteStream.ts";
import { QuotePreviewError, quoteResponseError } from "../../app/utils/quoteErrors.ts";
import { diagnosticReferences, retainDiagnosticReferences, type DiagnosticReferences } from "../../app/utils/diagnosticReferences.ts";
import { basketFacts, configuredToken, coreIntentRequest, ScenarioUnavailableError, type Scenario } from "./scenarios.ts";

export type ScenarioResult = Pick<Scenario, "id" | "family" | "inputMode" | "asset"> & {
  requestedStrategy: "core" | "market" | "auto";
  status: "pass" | "fail" | "unavailable" | "skipped"; actualStrategy: "core" | "market" | "unknown";
  actualOperation?: string; quotedOperation?: string; layer: "api" | "browser" | "execution"; durationMs?: number; firstExecutableMs?: number;
  code?: string; refs?: DiagnosticReferences; transactionHash?: string;
  context?: { chainId: number; blockNumber: string; blockHash: string }; bounds?: Record<string, string | string[]>;
  receipt?: Record<string, string | string[]>; authorization?: string[];
};
export type RegressionReport = { schema: "cybergold.trade-regression.v1"; runId: string; target: "sandbox" | "mainnet";
  mode: "quotes" | "sandbox-execution" | "fork-execution"; startedAt: string; finishedAt?: string;
  observations?: { chainId?: number; forkGeneration?: string | null; correlationAvailable?: boolean };
  context?: { appRevision?: string; backendRevision?: string; backendImageId?: string; blockNumber?: string; blockHash?: string };
  runnerOutcome?: "pass" | "fail" | "unavailable"; runnerCode?: string; scenarios: ScenarioResult[] };
export type QuoteObservation = { scenario: Scenario; request: TradeQuoteRequest | BasketPreviewRequest;
  value: QuoteIntent | MarketQuote | BasketPreview; result: ScenarioResult };

export class RegressionAssertionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function requireInvariant(value: unknown, code: string): asserts value {
  if (!value) throw new RegressionAssertionError(code);
}
export function uint(value: string, name: string) {
  requireInvariant(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), `invalid-${name}`);
  const integer = BigInt(value); requireInvariant(integer < 2n ** 256n, `invalid-${name}`); return integer;
}
export function resultFor(scenario: Scenario, layer: ScenarioResult["layer"]): ScenarioResult {
  return { id: scenario.id, family: scenario.family, inputMode: scenario.inputMode, requestedStrategy: scenario.requestedStrategy,
    asset: scenario.asset, status: "unavailable", actualStrategy: "unknown", layer };
}
export function failureResult(result: ScenarioResult, error: unknown) {
  const code = error instanceof QuotePreviewError || error instanceof RegressionAssertionError || error instanceof ScenarioUnavailableError
    ? error.code : "unexpected-error";
  const unavailable = error instanceof QuotePreviewError || error instanceof ScenarioUnavailableError || /Timeout|Abort/.test((error as Error)?.name ?? "");
  return { ...result, status: unavailable ? "unavailable" as const : "fail" as const,
    code: unavailable && code === "unexpected-error" ? "service-unavailable" : code,
    refs: { ...result.refs, ...diagnosticReferences(error) } };
}

export function originFetch(origin: string, observeResponse?: (response: Response) => void): typeof fetch {
  return ((path: string | URL | Request, init?: RequestInit) => fetch(new URL(String(path), origin), {
    ...init, signal: init?.signal ?? AbortSignal.timeout(75_000),
  }).then(response => { try { observeResponse?.(response); } catch { /* Optional observation is independent. */ } return response; })) as typeof fetch;
}
export async function readJson<T>(fetcher: typeof fetch, path: string, request?: unknown): Promise<T> {
  const response = await fetcher(path, { cache: "no-store", ...(request === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  }) }).catch(() => { throw new QuotePreviewError("quote-service-unavailable", "quote-service-unavailable"); });
  if (!response.ok) throw await quoteResponseError(response);
  const value = await response.json();
  retainDiagnosticReferences(value, { requestId: response.headers.get("X-CyberGold-Request-Id") ?? undefined });
  return value;
}

export function tokenRequest(scenario: Scenario, config: ProtocolConfiguration, recipient: string): TradeQuoteRequest {
  const counter = configuredToken(config, scenario.asset), cygld = configuredToken(config, "CYGLD");
  const cygldAmount = (scenario.side === "buy") !== (scenario.inputMode === "exact-in");
  const wrapped = scenario.asset === "ETH" ? configuredToken(config, "WETH") : counter;
  requireInvariant(wrapped.type === "erc20", "token-unavailable");
  return { side: scenario.side, mode: scenario.inputMode, counterToken: wrapped.address, native: scenario.asset === "ETH",
    amount: String(parseUnits(scenario.displayAmount, cygldAmount ? cygld.decimals : counter.decimals)),
    recipient, deadline: String(Math.floor(Date.now() / 1000) + 1200), slippageBps: 100 };
}

export async function basketRequest(scenario: Scenario, config: ProtocolConfiguration, facts: ProtocolFacts,
  fetcher: typeof fetch): Promise<BasketPreviewRequest> {
  const cygldAmount = String(parseUnits(scenario.displayAmount, configuredToken(config, "CYGLD").decimals));
  if (scenario.side === "buy" && scenario.inputMode === "exact-out") return { mode: "issue-exact-out", netCygldOut: cygldAmount };
  if (scenario.side === "sell" && scenario.inputMode === "exact-in") return { mode: "redeem-exact-in", grossCygldIn: cygldAmount };
  // Canonical previews supply the complete current vector. Scale a small unit
  // amount from that vector rather than inventing basket membership/order.
  const unit = await readJson<BasketPreview>(fetcher, "/api/quotes/basket-preview", scenario.side === "buy"
    ? { mode: "issue-exact-out", netCygldOut: String(parseUnits("0.25", configuredToken(config, "CYGLD").decimals)) }
    : { mode: "redeem-exact-in", grossCygldIn: String(parseUnits("0.25", configuredToken(config, "CYGLD").decimals)) });
  if (unit.mode === "issue-exact-out") return { mode: "issue-exact-in", maximumAmountsIn: unit.result.amountsInExact.map(amount => String((BigInt(amount) * 101n + 99n) / 100n)) };
  requireInvariant(unit.mode === "redeem-exact-in", "basket-mode-mismatch");
  void basketFacts(facts);
  return { mode: "redeem-exact-out", minimumOutputs: unit.result.projectedCoreOutputs.map(output => ({
    kind: output.kind, token: output.token, id: output.id, minimumAmount: String(BigInt(output.amount) * 99n / 100n),
  })) };
}

export function validateTrade(value: Pick<TradeQuote, "mode" | "side" | "quotedInput" | "quotedOutput" | "inputMaximum" | "outputMinimum">, request: Pick<TradeQuoteRequest, "mode" | "side" | "amount">) {
  requireInvariant(value.mode === request.mode && value.side === request.side, "trade-intent-mismatch");
  const input = uint(value.quotedInput, "quoted-input"), output = uint(value.quotedOutput, "quoted-output"),
    maximum = uint(value.inputMaximum, "maximum-input"), minimum = uint(value.outputMinimum, "minimum-output");
  requireInvariant(input > 0n && output > 0n, "zero-executable-amount");
  requireInvariant(maximum >= input && minimum > 0n && minimum <= output, "execution-bound-mismatch");
  if (request.mode === "exact-in") requireInvariant(maximum <= BigInt(request.amount), "input-budget-exceeded");
  else requireInvariant(minimum >= BigInt(request.amount), "output-target-not-protected");
  return { quotedInput: value.quotedInput, quotedOutput: value.quotedOutput, inputMaximum: value.inputMaximum, outputMinimum: value.outputMinimum };
}

export function coreTrade(value: QuoteIntent, request: TradeQuoteRequest, config: ProtocolConfiguration): TradeQuote {
  const buy = request.side === "buy", exactIn = request.mode === "exact-in", cygld = config.contracts.core!;
  const counter = request.native ? zeroAddress : request.counterToken;
  const output = buy ? value.executionAmount : value.expectedOutputAmount ?? (exactIn ? value.displayAmount : "minimumAmountOut" in value.preview ? value.preview.minimumAmountOut : "0");
  return { strategy: "core", side: request.side, mode: request.mode, tokenIn: buy ? counter : cygld, tokenOut: buy ? cygld : counter,
    quotedInput: buy ? value.expectedInputAmount ?? value.maximumInputAmount : value.executionAmount,
    quotedOutput: output, inputMaximum: buy ? value.maximumInputAmount : value.executionAmount,
    outputMinimum: buy ? value.executionAmount : "minimumAmountOut" in value.preview ? value.preview.minimumAmountOut : "0",
    context: value.context, providerRequest: {} as never, providerQuote: value, evaluation: { core: "complete", market: "unsupported" }, metrics: { totalMs: 0, targetReads: 0 } };
}

export async function observeScenario(scenario: Scenario, config: ProtocolConfiguration, facts: ProtocolFacts,
  fetcher: typeof fetch, recipient = config.contracts.helpers!): Promise<QuoteObservation> {
  const started = performance.now(), result = resultFor(scenario, "api");
  const signal = AbortSignal.timeout(75_000);
  const events = (event: { type: string }) => {
    if (event.type === "qualified" && result.firstExecutableMs === undefined) result.firstExecutableMs = Math.round(performance.now() - started);
  };
  let request: TradeQuoteRequest | BasketPreviewRequest, value: QuoteObservation["value"];
  if (scenario.asset === "BASKET") {
    const basket = await basketRequest(scenario, config, facts, fetcher);
    const preview = await readJson<BasketPreview>(fetcher, "/api/quotes/basket-preview", basket);
    request = basket; value = preview;
    requireInvariant(value.mode === request.mode, "basket-mode-mismatch");
    const fees = value.result.fees; uint(fees.protocolFeeCygld, "protocol-fee"); uint(fees.helperFeeCygld, "helpers-fee");
    if (value.mode === "issue-exact-in" || value.mode === "issue-exact-out") {
      requireInvariant(value.result.amountsInExact.length === basketFacts(facts).assets.length, "basket-order-mismatch");
      value.result.amountsInExact.forEach(amount => uint(amount, "basket-input"));
      if (basket.mode === "issue-exact-in") value.result.amountsInExact.forEach((amount, index) => requireInvariant(BigInt(amount) <= BigInt(basket.maximumAmountsIn[index]), "basket-budget-exceeded"));
      result.bounds = { inputMaximum: request.mode === "issue-exact-in" ? request.maximumAmountsIn : value.result.amountsInExact,
        outputMinimum: value.mode === "issue-exact-in" ? value.result.netCygldOut : request.mode === "issue-exact-out" ? request.netCygldOut : "0" };
      requireInvariant(BigInt(result.bounds.outputMinimum as string) > 0n, "zero-executable-amount");
      result.quotedOperation = value.mode === "issue-exact-in" ? "issueFromBasketExactIn" : "issueFromBasketExactOut";
    } else {
      requireInvariant(value.result.projectedCoreOutputs.some(output => BigInt(output.amount) > 0n), "zero-executable-amount");
      value.result.projectedCoreOutputs.forEach(output => uint(output.amount, "basket-output"));
      if (basket.mode === "redeem-exact-out" && (preview.mode === "redeem-exact-in" || preview.mode === "redeem-exact-out")) basket.minimumOutputs.forEach((minimum, index) => {
        const output = preview.result.projectedCoreOutputs[index];
        requireInvariant(output?.kind === minimum.kind && output?.token.toLowerCase() === minimum.token.toLowerCase() && output?.id === minimum.id, "basket-output-order-mismatch");
        requireInvariant(BigInt(output.amount) >= BigInt(minimum.minimumAmount), "basket-output-target-not-protected");
      });
      result.bounds = { inputMaximum: value.mode === "redeem-exact-out" ? value.result.grossCygldIn : request.mode === "redeem-exact-in" ? request.grossCygldIn : "0",
        outputMinimum: request.mode === "redeem-exact-out" ? request.minimumOutputs.map(row => row.minimumAmount) : value.result.projectedCoreOutputs.map(row => String(BigInt(row.amount) * 99n / 100n)) };
      result.quotedOperation = "redeemToBasketExactIn";
    }
  } else {
    request = tokenRequest(scenario, config, recipient);
    if (scenario.requestedStrategy === "core") {
      const { assets, weights } = basketFacts(facts), provider = coreIntentRequest(request, config.contracts.uniswapAdapter!, assets, weights);
      value = await fetchQuoteStream<QuoteIntent, { type: string }>("/api/quotes/intent/stream", provider, signal, events, fetcher);
      requireInvariant(value.mode === provider.mode, "core-provider-mode-mismatch");
      result.bounds = validateTrade(coreTrade(value, request, config), request);
      uint(value.preview.fees.protocolFeeCygld, "protocol-fee"); uint(value.preview.fees.helperFeeCygld, "helpers-fee");
      result.quotedOperation = scenario.side === "buy" ? scenario.asset === "ETH" ? "issueFromNativeExactOut" : "issueFromTokenExactOut"
        : scenario.asset === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
    } else {
      const { native: _native, ...marketRequest } = request;
      void _native;
      value = await fetchQuoteStream<MarketQuote, { type: string }>("/api/quotes/market/stream", marketRequest, signal, events, fetcher);
      const tokenIn = request.side === "buy" ? request.counterToken : config.contracts.core!, tokenOut = request.side === "buy" ? config.contracts.core! : request.counterToken;
      requireInvariant(value.tokenIn.toLowerCase() === tokenIn.toLowerCase() && value.tokenOut.toLowerCase() === tokenOut.toLowerCase()
        && value.params.counterToken.toLowerCase() === request.counterToken.toLowerCase(), "market-token-mismatch");
      result.bounds = validateTrade({ ...value, quotedInput: value.totalInput, quotedOutput: value.netOutput }, request);
      uint(value.fee.amount, "helpers-fee"); uint(value.refundDust, "refund");
      result.bounds = { ...result.bounds, protocolFeeCygld: "0", helperFeeCygld: value.fee.amount, refundDust: value.refundDust };
      result.quotedOperation = request.mode === "exact-in" ? "swapExactInput" : "swapExactOutput";
    }
  }
  if (scenario.requestedStrategy === "core") {
    const fees = "result" in value ? value.result.fees : "preview" in value ? value.preview.fees : undefined;
    if (fees) result.bounds = { ...result.bounds, protocolFeeCygld: fees.protocolFeeCygld, helperFeeCygld: fees.helperFeeCygld };
  }
  result.status = "pass"; result.actualStrategy = scenario.requestedStrategy;
  result.refs = diagnosticReferences(value); result.context = value.context;
  result.durationMs = Math.round(performance.now() - started);
  result.firstExecutableMs ??= result.durationMs;
  return { scenario, request, value, result };
}
