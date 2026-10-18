import { parseUnits, zeroAddress } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { BasketPreview, BasketPreviewRequest } from "../../app/utils/basketPreview.ts";
import type { QuoteIntent } from "../../app/utils/quoteIntent.ts";
import type { MarketQuote } from "../../app/utils/marketQuote.ts";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote.ts";
import { fetchQuoteStream } from "../../app/utils/quoteStream.ts";
import { QuotePreviewError, quoteResponseError, safeQuoteConstraint, type QuoteConstraint } from "../../app/utils/quoteErrors.ts";
import { diagnosticReferences, quoteDiagnostics, retainDiagnosticReferences, type DiagnosticReferences, type QuoteDiagnostics } from "../../app/utils/diagnosticReferences.ts";
import { basketFacts, configuredToken, coreIntentRequest, ScenarioUnavailableError, type Scenario } from "./scenarios.ts";
import type { UiQuoteSnapshot, UiWalletEvidence } from "./uiEconomics.ts";
import type { WalletRequestDiagnostic } from "./runnerDiagnostics.ts";
import type { QualityTerms, QualityMeasurement } from "./quoteQuality.ts";
import { tradeQualityTerms, basketQualityTerms } from "./quoteQuality.ts";

export type UiObservationPhase = "ui-prepare" | "ui-facts" | "ui-balances" | "ui-submit" | "ui-confirmation"
  | "ui-hash" | "ui-receipt-read" | "ui-transaction-read" | "ui-receipt-assertions" | "ui-balance-postchecks";
export const executionStages = ["execution-plan", "authorization-availability", "allowance-read", "approval-submission",
  "approval-confirmation", "native-permit-read", "permit2-read", "authorization-signature", "execution-simulation",
  "execution-encoding", "execution-submission", "execution-confirmation", "execution-transaction-read",
  "execution-receipt-assertions", "complete", "setup-config", "setup-navigation", "setup-network-add",
  "setup-network-switch", "setup-connect-request", "setup-connect-confirm", "setup-wallet-ready", "setup-accounts",
  "setup-funding", "setup-rejection-submit", "setup-rejection-wallet", "setup-rejection-postcheck", "setup-ready",
  "ui-prepare-navigation", "ui-prepare-wallet", "ui-prepare-tokens", "ui-prepare-amount", "ui-prepare-quote",
  "ui-prepare-details", "ui-prepare-swap", "ui-prepare", "ui-facts", "ui-balances", "ui-submit", "ui-confirmation",
  "ui-hash", "ui-receipt-read", "ui-transaction-read", "ui-receipt-assertions", "ui-balance-postchecks",
  "execution-facts", "execution-quote"] as const;
export type ExecutionStage = typeof executionStages[number];
import type { ProviderSummary, AlternateExecution, Provider } from "./providerEvidence.ts";

export type ScenarioResult = Pick<Scenario, "id" | "family" | "inputMode" | "asset"> & {
  size?: "small" | "medium" | "large"; nominalUsd?: string; valuationId?: string; amountRaw?: string; basketAmounts?: string[]; basketAssets?: string[];
  deployment?: import("../../app/utils/protocolConfiguration.ts").ProtocolDeployment;
  providers?: Record<Provider, ProviderSummary>; alternateExecution?: AlternateExecution;
  selectedProvider?: Provider; planDigest?: string; revalidatedPlanDigest?: string; executionAttempted?: boolean;
  transactionDisposition?: "not-submitted" | "submitted" | "confirmed" | "unknown";
  requestedStrategy: "core" | "market" | "auto";
  status: "pass" | "fail" | "unavailable" | "skipped"; actualStrategy: "core" | "market" | "unknown";
  actualOperation?: string; quotedOperation?: string; layer: "api" | "browser" | "execution"; durationMs?: number; firstExecutableMs?: number;
  code?: string; reason?: QuotePreviewError["code"] | UiObservationPhase | "unsupported" | "no-qualified-plan" | "quote-observation-unavailable" | "predecessor-submission-unknown"; refs?: DiagnosticReferences; transactionHash?: string;
  quoteDiagnostics?: QuoteDiagnostics;
  constraint?: QuoteConstraint;
  context?: { chainId: number; blockNumber: string; blockHash: string }; bounds?: Record<string, string | string[]>;
  receipt?: Record<string, string | string[] | { asset: string; amount: string }[]>; authorization?: string[];
  executionStage?: ExecutionStage; errorClass?: string; errorCode?: string; walletRequestErrorCode?: number; approvalTransactionHashes?: string[];
  lastApproval?: { assetAddress: string; spenderAddress: string; amountRaw: string }; walletRequest?: WalletRequestDiagnostic;
  uiQuote?: UiQuoteSnapshot; wallet?: UiWalletEvidence;
  uiConfirmation?: import('./runnerDiagnostics.ts').UiConfirmationDiagnostic;
  quoteTerms?: QualityTerms; executionTerms?: QualityTerms; quoteQuality?: QualityMeasurement; executionQuality?: QualityMeasurement;
};
export type RegressionReport = { schema: "cybergold.trade-regression.v1"; runId: string; target: "sandbox" | "mainnet";
  mode: "quotes" | "sandbox-execution" | "fork-execution"; startedAt: string; finishedAt?: string;
  observations?: { chainId?: number; forkGeneration?: string | null; correlationAvailable?: boolean };
  context?: { appRevision?: string; backendRevision?: string; backendImageId?: string; blockNumber?: string; blockHash?: string };
  qualification?: { result?: "running" | "pass" | "fail"; stage?: string; errorClass?: string;
    cleanup?: Partial<Record<"processes" | "containers" | "network" | "source", "complete" | "failed">> };
  runnerOutcome?: "pass" | "fail" | "unavailable"; runnerCode?: string; scenarios: ScenarioResult[]; fixtures?: ScenarioResult[] };
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
    ...(scenario.size ? { size: scenario.size, nominalUsd: scenario.nominalUsd, valuationId: scenario.valuationId, amountRaw: scenario.amountRaw, ...(scenario.basketAmounts ? { basketAmounts: [...scenario.basketAmounts] } : {}), ...(scenario.basketAssets ? { basketAssets: [...scenario.basketAssets] } : {}) } : {}),
    asset: scenario.asset, status: "unavailable", code: "not-exercised", actualStrategy: "unknown", layer };
}
/** Optional local evidence records the latest entered phase, without changing the operation. */
export async function checkpointExecutionStage(results: readonly ScenarioResult[], stage: ExecutionStage, persist: () => Promise<void>) {
  for (const result of results) result.executionStage = stage;
  try { await persist(); } catch { /* An optional observation write cannot reject an existing action. */ }
}
// These runner prerequisites prevented a case from starting. Once an expected
// positive path is attempted, an unavailable dependency is a failed test.
const unexercisedRunnerCodes = new Set([
  "app-origin-unavailable", "fork-fixture-configuration-unavailable", "browser-unavailable",
  "wallet-setup-unavailable", "wallet-rpc-unavailable", "valuation-unavailable",
]);
export function failureResult(result: ScenarioResult, error: unknown) {
  const code = error instanceof QuotePreviewError || error instanceof RegressionAssertionError || error instanceof ScenarioUnavailableError
    ? error.code : "unexpected-error";
  const unavailable = error instanceof ScenarioUnavailableError && unexercisedRunnerCodes.has(error.code);
  const timedOut = /Timeout|Abort/.test((error as Error)?.name ?? "");
  const work = quoteDiagnostics(error) ?? quoteDiagnostics(result);
  const constraint = safeQuoteConstraint((error as { constraint?: unknown } | null)?.constraint) ?? result.constraint;
  return { ...result, status: unavailable ? "unavailable" as const : "fail" as const,
    code: timedOut && code === "unexpected-error" ? "service-unavailable" : code,
    quoteDiagnostics: work,
    ...(constraint ? { constraint } : {}),
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
    amount: scenario.amountRaw ?? String(parseUnits(scenario.displayAmount, cygldAmount ? cygld.decimals : counter.decimals)),
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

/** Match the edited basket amount, rather than an earlier empty warm request. */
export function matchesBasketIntent(request: unknown, scenario: Scenario, amount: string, assets: readonly string[]) {
  if (!request || typeof request !== "object") return false;
  const value = request as BasketPreviewRequest;
  if (scenario.basketAmounts) {
    if (value.mode === "issue-exact-in") return JSON.stringify(value.maximumAmountsIn) === JSON.stringify(scenario.basketAmounts);
    if (value.mode === "redeem-exact-out") return scenario.basketAmounts.every((amount, i) => value.minimumOutputs.some(row => row.kind === 0 && row.token.toLowerCase() === scenario.basketAssets?.[i].toLowerCase() && row.minimumAmount === amount));
  }
  if (value.mode !== `${scenario.side === "buy" ? "issue" : "redeem"}-${scenario.inputMode}`) return false;
  if (value.mode === "issue-exact-out") return value.netCygldOut === amount;
  if (value.mode === "redeem-exact-in") return value.grossCygldIn === amount;
  const positive = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n;
  if (value.mode === "issue-exact-in") return Array.isArray(value.maximumAmountsIn)
    && value.maximumAmountsIn.length === assets.length && value.maximumAmountsIn[0] === amount && value.maximumAmountsIn.some(positive);
  return Array.isArray(value.minimumOutputs) && value.minimumOutputs.some(row => row.kind === 0
    && typeof row.token === "string" && row.token.toLowerCase() === assets[0]?.toLowerCase() && row.id === "0" && row.minimumAmount === amount)
    && value.minimumOutputs.some(row => positive(row.minimumAmount));
}

export function validateBasket(value: BasketPreview, request: BasketPreviewRequest, assets: readonly string[]): Record<string, string | string[]> {
  requireInvariant(value.mode === request.mode, "basket-mode-mismatch");
  uint(value.result.fees.protocolFeeCygld, "protocol-fee"); uint(value.result.fees.helperFeeCygld, "helpers-fee");
  if (value.mode === "issue-exact-in" || value.mode === "issue-exact-out") {
    requireInvariant(value.result.amountsInExact.length === assets.length && value.result.orderedCoreAssets.length === assets.length
      && value.result.orderedCoreAssets.every((token, index) => token.toLowerCase() === assets[index].toLowerCase()), "basket-order-mismatch");
    requireInvariant(value.result.amountsInExact.some(amount => uint(amount, "basket-input") > 0n), "zero-executable-amount");
    value.result.amountsInExact.forEach(amount => uint(amount, "basket-input"));
    if (request.mode === "issue-exact-in") {
      requireInvariant(request.maximumAmountsIn.length === assets.length, "basket-budget-vector-mismatch");
      value.result.amountsInExact.forEach((amount, index) => requireInvariant(BigInt(amount) <= uint(request.maximumAmountsIn[index], "basket-budget"), "basket-budget-exceeded"));
    }
    const minimum = value.mode === "issue-exact-in" ? value.result.netCygldOut : request.mode === "issue-exact-out" ? request.netCygldOut : "0";
    requireInvariant(uint(minimum, "basket-output") > 0n, "zero-executable-amount");
    return { inputMaximum: request.mode === "issue-exact-in" ? request.maximumAmountsIn : value.result.amountsInExact, outputMinimum: minimum };
  }
  const outputs = value.result.projectedCoreOutputs, coreOutputs = outputs.filter(output => output.kind === 0);
  requireInvariant(coreOutputs.length === assets.length && coreOutputs.every((output, index) => output.token.toLowerCase() === assets[index].toLowerCase()
    && output.id === "0"), "basket-output-order-mismatch");
  outputs.forEach(output => uint(output.amount, "basket-output"));
  requireInvariant(coreOutputs.some(output => BigInt(output.amount) > 0n), "zero-executable-amount");
  if (request.mode === "redeem-exact-out") {
    requireInvariant(request.minimumOutputs.length === outputs.length, "basket-output-vector-mismatch");
    request.minimumOutputs.forEach((minimum, index) => {
      const output = outputs[index];
      requireInvariant(output.kind === minimum.kind && output.token.toLowerCase() === minimum.token.toLowerCase() && output.id === minimum.id, "basket-output-order-mismatch");
      requireInvariant(BigInt(output.amount) >= uint(minimum.minimumAmount, "basket-minimum"), "basket-output-target-not-protected");
    });
  }
  const maximum = value.mode === "redeem-exact-out" ? value.result.grossCygldIn : request.mode === "redeem-exact-in" ? request.grossCygldIn : "0";
  requireInvariant(uint(maximum, "basket-input") > 0n, "zero-executable-amount");
  return { inputMaximum: maximum, outputMinimum: request.mode === "redeem-exact-out"
    ? request.minimumOutputs.map(row => row.minimumAmount) : outputs.map(row => String(BigInt(row.amount) * 99n / 100n)) };
}

export function coreTrade(value: QuoteIntent, request: TradeQuoteRequest, config: ProtocolConfiguration): Extract<TradeQuote, { strategy: 'core' }> {
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
    result.bounds = validateBasket(preview, basket, basketFacts(facts).assets);
    result.quoteTerms = basketQualityTerms(preview, basket, config.contracts.core!);
    if (value.mode === "issue-exact-in" || value.mode === "issue-exact-out") {
      result.quotedOperation = value.mode === "issue-exact-in" ? "issueFromBasketExactIn" : "issueFromBasketExactOut";
    } else {
      result.quotedOperation = "redeemToBasketExactIn";
    }
  } else {
    request = tokenRequest(scenario, config, recipient);
    if (scenario.requestedStrategy === "core") {
      const { assets, weights } = basketFacts(facts), provider = coreIntentRequest(request, config.contracts.uniswapAdapter!, assets, weights);
      value = await fetchQuoteStream<QuoteIntent, { type: string }>("/api/quotes/intent/stream", provider, signal, events, fetcher);
      requireInvariant(value.mode === provider.mode, "core-provider-mode-mismatch");
      result.bounds = validateTrade(coreTrade(value, request, config), request);
      result.quoteTerms = tradeQualityTerms({ ...coreTrade(value, request, config), providerRequest: provider });
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
      result.quoteTerms = tradeQualityTerms({ strategy: "market", side: request.side, mode: request.mode, tokenIn, tokenOut,
        quotedInput: value.totalInput, quotedOutput: value.netOutput, inputMaximum: value.inputMaximum,
        providerRequest: marketRequest, providerQuote: value });
      result.quotedOperation = request.mode === "exact-in" ? "swapExactInput" : "swapExactOutput";
    }
  }
  if (scenario.requestedStrategy === "core") {
    const fees = "result" in value ? value.result.fees : "preview" in value ? value.preview.fees : undefined;
    if (fees) result.bounds = { ...result.bounds, protocolFeeCygld: fees.protocolFeeCygld, helperFeeCygld: fees.helperFeeCygld };
  }
  result.status = "pass"; delete result.code; result.actualStrategy = scenario.requestedStrategy;
  result.refs = diagnosticReferences(value); result.context = value.context;
  result.durationMs = Math.round(performance.now() - started);
  result.firstExecutableMs ??= result.durationMs;
  return { scenario, request, value, result };
}
