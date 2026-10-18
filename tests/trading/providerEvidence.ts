import type { components } from '../../app/contracts/backend/http';
import type { TradeSelectionObservation } from '../../app/utils/tradeSelectionObservation.ts';
import type { TradeQuote, TradeQuoteRequest } from '../../app/utils/tradeQuote.ts';
import { diagnosticReferences, safeDiagnosticReferences, safeQuoteDiagnostics, type QuoteDiagnostics } from '../../app/utils/diagnosticReferences.ts';
import { fetchQuoteStream } from '../../app/utils/quoteStream.ts';
import { knownQuoteError, safeQuoteConstraint, type QuoteConstraint } from '../../app/utils/quoteErrors.ts';
import type { BasketPreview, BasketPreviewRequest } from '../../app/utils/basketPreview.ts';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import type { Page } from '@playwright/test';
import { semanticDigest, type MatrixScenario } from './matrix.ts';
import type { QuoteObservation as BrowserQuoteObservation } from './quoteObservation.ts';
import { resultFor, validateTrade, failureResult, requireInvariant, matchesBasketIntent, type QuoteObservation, type ScenarioResult } from './regression.ts';
import { safeSelectedPlan, type SelectedPlan } from './selectedPlan.ts';
import type { Scenario } from './scenarios.ts';
import { tradeQualityTerms, basketQualityTerms, type QualityTerms, type QualityMeasurement } from './quoteQuality.ts';

export type Provider = 'core' | 'market';
export type ProviderAssessment = NonNullable<TradeQuote['providerAssessments']>['core'];
export type Candidate = components['schemas']['TradeProviderCandidate'];
export type ProviderQuote = TradeQuote;
export type ProviderSummary = Pick<ProviderAssessment, 'availability' | 'searchOutcome'> & { code?: string; constraint?: QuoteConstraint; quoteDiagnostics?: QuoteDiagnostics; selectedPlan?: SelectedPlan; refs?: ScenarioResult['refs']; context?: ScenarioResult['context']; planDigest?: string; bounds?: ScenarioResult['bounds']; quoteTerms?: QualityTerms; quoteQuality?: QualityMeasurement };
export type AlternateExecution = Omit<ScenarioResult, 'providers' | 'alternateExecution'> & { provider: Provider; role: 'alternate'; attempted: boolean; comparisonState: 'sequential-state' | 'restored-baseline' };
export const emptyProviders = (): Record<Provider, ProviderSummary> => ({ core: { availability: 'not-run', searchOutcome: 'not-run', code: 'provider-evidence-unavailable' }, market: { availability: 'not-run', searchOutcome: 'not-run', code: 'provider-evidence-unavailable' } });

/** Fingerprint executable terms; producer timing and tracing do not change a plan. */
const observationFields = new Set(['metrics', 'evaluation', 'diagnostics', 'quoteDiagnostics', 'refs', 'requestId', 'attemptId', 'correlationId', 'workId', 'observedAt', 'providerAssessments', 'providerCandidates']);
const executableTerms = (v: unknown): unknown => Array.isArray(v) ? v.map(executableTerms) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([key]) => !observationFields.has(key)).map(([key, child]) => [key, executableTerms(child)])) : v;
export function planDigest(value: Candidate, deployment?: SelectionCapture['deployment']) {
  return semanticDigest({ strategy: value.strategy, side: value.side, mode: value.mode, tokenIn: value.tokenIn, tokenOut: value.tokenOut,
    quotedInput: value.quotedInput, quotedOutput: value.quotedOutput, inputMaximum: value.inputMaximum, outputMinimum: value.outputMinimum,
    context: executableTerms(value.context), providerRequest: executableTerms(value.providerRequest), providerQuote: executableTerms(value.providerQuote), deployment });
}
export function providerSummaries(value: Partial<ProviderQuote>, deployment?: SelectionCapture['deployment']): Record<Provider, ProviderSummary> {
  const result = emptyProviders();
  for (const provider of ['core', 'market'] as const) {
    const assessment = value.providerAssessments?.[provider], candidate = value.providerCandidates?.[provider];
    const constraint = safeQuoteConstraint((assessment as { constraint?: unknown } | undefined)?.constraint);
    const quoteDiagnostics = safeQuoteDiagnostics((assessment as { quoteDiagnostics?: unknown } | undefined)?.quoteDiagnostics)
      ?? safeQuoteDiagnostics((candidate?.providerQuote as { quoteDiagnostics?: unknown } | undefined)?.quoteDiagnostics);
    if (assessment) result[provider] = { availability: assessment.availability, searchOutcome: assessment.searchOutcome,
      ...(assessment.code ? { code: assessment.code } : {}), ...(constraint ? { constraint } : {}),
      ...(quoteDiagnostics ? { quoteDiagnostics } : {}) };
    if (candidate && assessment?.availability === 'qualified') result[provider] = { ...result[provider],
      refs: diagnosticReferences(candidate.providerQuote), context: candidate.context, planDigest: planDigest(candidate, deployment),
      selectedPlan: safeSelectedPlan(candidate.providerQuote, provider, candidate), quoteTerms: tradeQualityTerms(candidate),
      bounds: { quotedInput: candidate.quotedInput, quotedOutput: candidate.quotedOutput, inputMaximum: candidate.inputMaximum, outputMinimum: candidate.outputMinimum } };
  }
  return result;
}
export type SelectionCapture = TradeSelectionObservation;
type SelectionWindow = Window & { __cybergoldSelections?: SelectionCapture[] };
/** Same synchronous capture emitted by the real product, never a guessed fetch winner. */
export function installSelectionCapture(scope: SelectionWindow = window) {
  scope.__cybergoldSelections = [];
  scope.addEventListener('cybergold:trade-selection', event => {
    const detail = (event as CustomEvent<SelectionCapture>).detail;
    if (detail?.quote || detail?.basketRequest) scope.__cybergoldSelections!.push(structuredClone(detail));
  });
}
export async function selectionCaptures(page: Page): Promise<SelectionCapture[]> {
  return page.evaluate(() => (window as SelectionWindow).__cybergoldSelections ?? []);
}
export function captureSelection(value: SelectionCapture) {
  const captured = structuredClone(value), quote = captured.quote;
  if (!quote) throw new Error('token-selection-not-observed');
  return { captured, primary: { selectedProvider: quote.strategy, planDigest: planDigest(quote, captured.deployment),
    bounds: { quotedInput: quote.quotedInput, quotedOutput: quote.quotedOutput, inputMaximum: quote.inputMaximum, outputMinimum: quote.outputMinimum }, context: quote.context, deployment: captured.deployment,
    ...(safeQuoteDiagnostics((quote.providerQuote as { quoteDiagnostics?: unknown }).quoteDiagnostics) ? { quoteDiagnostics: safeQuoteDiagnostics((quote.providerQuote as { quoteDiagnostics?: unknown }).quoteDiagnostics) } : {}), selectedPlan: safeSelectedPlan(quote.providerQuote, quote.strategy, quote), providers: providerSummaries(quote, captured.deployment), quoteTerms: tradeQualityTerms(quote), refs: { ...diagnosticReferences(quote.providerQuote), ...safeDiagnosticReferences(captured.diagnostics) } }, alternate: quote.providerCandidates?.[quote.strategy === 'core' ? 'market' : 'core'] };
}
/** A basket winner is linked only to the preview frozen by its actual click. */
export function captureBasketSelection(value: SelectionCapture): Pick<ScenarioResult, 'selectedProvider' | 'planDigest' | 'selectedPlan' | 'quoteDiagnostics'> {
  const preview = value.basketPreview;
  if (!preview) return {};
  const quoteDiagnostics = safeQuoteDiagnostics((preview as { quoteDiagnostics?: unknown }).quoteDiagnostics);
  return { selectedProvider: 'core' as const, planDigest: semanticDigest({ request: executableTerms(value.basketRequest), preview: executableTerms(preview) }),
    selectedPlan: safeSelectedPlan({ ...preview, basketRequest: value.basketRequest }, 'core'), ...(quoteDiagnostics ? { quoteDiagnostics } : {}) };
}
export function notAttemptedAlternate(scenario: Scenario, selected?: ProviderQuote): AlternateExecution {
  const provider = selected?.strategy === 'core' ? 'market' : 'core';
  const availability = selected?.providerAssessments?.[provider]?.availability;
  return { ...resultFor(scenario, 'execution'), id: `alternate-${scenario.id}`, provider, role: 'alternate', comparisonState: 'sequential-state', requestedStrategy: provider,
    status: 'unavailable', code: 'not-attempted', reason: (availability === 'unsupported' ? 'unsupported' : selected ? 'no-qualified-plan' : 'quote-observation-unavailable') as ScenarioResult['reason'],
    attempted: false, executionAttempted: false, transactionDisposition: 'not-submitted' };
}

/** Replay the captured losing plan through the existing retained-plan contract.
 * Shared Sandbox state is never reset. Revalidation has its own request refs and
 * context; the original captured digest survives any failure or renewed terms.
 */
export async function executeAlternate(capture: SelectionCapture, scenario: Scenario, request: TradeQuoteRequest,
  page: Page, owner: `0x${string}`, config: ProtocolConfiguration, fetcher: typeof fetch, execute?: typeof import('./walletExecution.ts').executeScenario, predecessorDisposition?: ScenarioResult['transactionDisposition'], comparisonState: AlternateExecution['comparisonState'] = 'sequential-state'): Promise<AlternateExecution> {
  const { alternate } = captureSelection(capture);
  let result = notAttemptedAlternate(scenario, capture.quote);
  result.comparisonState = comparisonState;
  if (predecessorDisposition === 'unknown') return { ...result, reason: 'predecessor-submission-unknown' };
  if (!alternate || capture.quote?.providerAssessments?.[result.provider]?.availability !== 'qualified') return result;
  result = { ...result, attempted: true, executionAttempted: true, code: 'execution-not-completed', executionStage: 'execution-quote', planDigest: planDigest(alternate, capture.deployment) };
  delete result.reason;
  const started = performance.now();
  try {
    const revalidated = await fetchQuoteStream<TradeQuote, { type: string }>('/api/quotes/trade/stream', { ...request,
      retainedPlan: { strategy: alternate.strategy, request: alternate.providerRequest, quote: alternate.providerQuote } }, AbortSignal.timeout(75_000), () => {}, fetcher);
    requireInvariant(revalidated.strategy === alternate.strategy && revalidated.tokenIn.toLowerCase() === alternate.tokenIn.toLowerCase() && revalidated.tokenOut.toLowerCase() === alternate.tokenOut.toLowerCase(), "retained-provider-mismatch");
    result.revalidatedPlanDigest = planDigest(revalidated, capture.deployment);
    result.refs = diagnosticReferences(revalidated);
    result.bounds = validateTrade(revalidated, request);
    result.quoteTerms = tradeQualityTerms(revalidated);
    result.selectedPlan = safeSelectedPlan(revalidated.providerQuote, revalidated.strategy, revalidated);
    result.quoteDiagnostics = safeQuoteDiagnostics((revalidated.providerQuote as { quoteDiagnostics?: unknown }).quoteDiagnostics);
    const observation = { scenario: { ...scenario, requestedStrategy: alternate.strategy }, request,
      value: revalidated.providerQuote, result } as QuoteObservation;
    const boundConfig = { ...config, contracts: { ...config.contracts,
      ...(capture.deployment?.core ? { core: capture.deployment.core } : {}),
      ...(capture.deployment?.helpers ? { helpers: capture.deployment.helpers } : {}),
      ...(alternate.providerRequest.adapter ? { uniswapAdapter: alternate.providerRequest.adapter } : {}) } };
    await (execute ?? (await import('./walletExecution.ts')).executeScenario)(observation, page, owner, boundConfig, fetcher);
    result.transactionDisposition = transactionDisposition(result);
  } catch (error) {
    result = { ...result, ...failureResult(result, error) };
    result.transactionDisposition = transactionDisposition(result);
  }
  result.durationMs = Math.round(performance.now() - started);
  return result;
}

/** Reduce only evidence emitted for this original UI request; never start another search. */
export function observedProviderEvidence(observation: { frames?: Record<string, unknown>[]; terminal?: Record<string, unknown> }): Partial<ProviderQuote> {
  const providerAssessments = {} as NonNullable<TradeQuote['providerAssessments']>, providerCandidates: NonNullable<TradeQuote['providerCandidates']> = {};
  for (const frame of observation.frames ?? []) {
    const strategy = frame.strategy as Provider;
    if (frame.type === 'provider-assessment' && (strategy === 'core' || strategy === 'market')) {
      providerAssessments[strategy] = structuredClone(frame.value as ProviderAssessment);
      if (providerAssessments[strategy].availability !== 'qualified') delete providerCandidates[strategy];
    }
    if (frame.type === 'provider-qualified') {
      if (strategy === 'core') providerCandidates.core = structuredClone(frame.value as Extract<Candidate, { strategy: 'core' }>);
      if (strategy === 'market') providerCandidates.market = structuredClone(frame.value as Extract<Candidate, { strategy: 'market' }>);
    }
  }
  const terminal = (observation.terminal?.type === 'complete' ? observation.terminal.value : observation.terminal) as Partial<ProviderQuote> | undefined;
  return terminal?.providerAssessments ? terminal : { providerAssessments, providerCandidates };
}

/** A later UI failure cannot erase the original basket provider observation. */
export function observedBasketProviderEvidence(observations: readonly BrowserQuoteObservation[], scenario: MatrixScenario, cygld?: string): Record<Provider, ProviderSummary> {
  const matching = observations.filter(row => row.path === '/api/quotes/basket-preview'
    && row.request.mode === `${scenario.side === 'buy' ? 'issue' : 'redeem'}-${scenario.inputMode}`
    && matchesBasketIntent(row.request, scenario, scenario.amountRaw, scenario.basketAssets ?? []));
  const observed = matching.findLast(row => row.terminal?.type === 'complete') ?? matching.at(-1);
  const providers = emptyProviders();
  providers.market = { availability: 'unsupported', searchOutcome: 'not-run' };
  if (!observed) return providers;
  const refs = { ...diagnosticReferences(observed.terminal), ...safeDiagnosticReferences({ requestId: observed.requestId }) };
  if (observed.terminal?.type === 'complete') {
    const preview = observed.terminal.value as BasketPreview;
    providers.core = { availability: 'qualified', searchOutcome: 'complete', selectedPlan: safeSelectedPlan({ ...preview, basketRequest: observed.request }, 'core'),
      ...(safeQuoteDiagnostics((preview as { quoteDiagnostics?: unknown }).quoteDiagnostics) ? { quoteDiagnostics: safeQuoteDiagnostics((preview as { quoteDiagnostics?: unknown }).quoteDiagnostics) } : {}), planDigest: semanticDigest({ request: executableTerms(observed.request), preview: executableTerms(preview) }), context: preview.context, refs,
      ...(cygld ? { quoteTerms: basketQualityTerms(preview, observed.request as BasketPreviewRequest, cygld) } : {}) };
  } else if (observed.terminal?.type === 'error') {
    const error = knownQuoteError(observed.terminal);
    const quoteDiagnostics = safeQuoteDiagnostics(observed.terminal.quoteDiagnostics);
    providers.core = { availability: 'unavailable', searchOutcome: error?.code === 'quote-timeout' ? 'timeout' : 'error', refs,
      ...(error ? { code: error.code, ...(error.constraint ? { constraint: error.constraint } : {}) } : {}),
      ...(quoteDiagnostics ? { quoteDiagnostics } : {}) };
  } else {
    providers.core = { availability: observed.interrupted ? 'unavailable' : 'pending', searchOutcome: observed.interrupted ? 'cancelled' : 'running', refs };
  }
  return providers;
}

export function executionCoverage(rows: readonly ScenarioResult[]) {
  const count = (values: { status: string }[]) => Object.fromEntries(['pass', 'fail', 'unavailable', 'skipped'].map(status => [status, values.filter(v => v.status === status).length]));
  const alternates = rows.flatMap(row => row.alternateExecution ? [row.alternateExecution] : []);
  return { scenarios: rows.length, providerAssessments: rows.reduce((n, row) => n + Object.keys(row.providers ?? {}).length, 0),
    uiAttempted: rows.filter(row => row.executionAttempted).length, ui: count([...rows]),
    alternateAttempted: alternates.filter(row => row.attempted).length, alternate: count(alternates),
    alternateNotAttempted: alternates.filter(row => !row.attempted).length };
}

/** Absence of a hash does not establish that a wallet submitted nothing. */
export function transactionDisposition(result: Pick<ScenarioResult, 'status' | 'transactionHash' | 'executionAttempted' | 'executionStage' | 'walletRequestErrorCode' | 'transactionDisposition'>): NonNullable<ScenarioResult['transactionDisposition']> {
  if (result.status === 'pass' && result.executionAttempted) return 'confirmed';
  if (result.transactionHash) return result.transactionDisposition === 'confirmed'
    || ['execution-receipt-assertions', 'ui-receipt-assertions', 'ui-balance-postchecks'].includes(result.executionStage ?? '') ? 'confirmed' : 'unknown';
  if (!result.executionAttempted || result.walletRequestErrorCode === 4001) return 'not-submitted';
  const stage = result.executionStage;
  if (!stage || stage.startsWith('setup-') || stage.startsWith('ui-prepare') || ['ui-facts', 'ui-balances', 'execution-facts', 'execution-quote', 'execution-plan', 'authorization-availability', 'allowance-read', 'approval-submission', 'approval-confirmation', 'native-permit-read', 'permit2-read', 'authorization-signature', 'execution-simulation', 'execution-encoding'].includes(stage)) return 'not-submitted';
  return 'unknown';
}
