import type { components } from '../../app/contracts/backend/http';
import type { TradeSelectionObservation } from '../../app/utils/tradeSelectionObservation.ts';
import type { TradeQuote, TradeQuoteRequest } from '../../app/utils/tradeQuote.ts';
import { diagnosticReferences, safeDiagnosticReferences } from '../../app/utils/diagnosticReferences.ts';
import { fetchQuoteStream } from '../../app/utils/quoteStream.ts';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import type { Page } from '@playwright/test';
import { semanticDigest } from './matrix.ts';
import { resultFor, validateTrade, failureResult, requireInvariant, type QuoteObservation, type ScenarioResult } from './regression.ts';
import type { Scenario } from './scenarios.ts';

export type Provider = 'core' | 'market';
export type ProviderAssessment = NonNullable<TradeQuote['providerAssessments']>['core'];
export type Candidate = components['schemas']['TradeProviderCandidate'];
export type ProviderQuote = TradeQuote;
export type ProviderSummary = Pick<ProviderAssessment, 'availability' | 'searchOutcome'> & { code?: string; refs?: ScenarioResult['refs']; context?: ScenarioResult['context']; planDigest?: string; bounds?: ScenarioResult['bounds'] };
export type AlternateExecution = Omit<ScenarioResult, 'providers' | 'alternateExecution'> & { provider: Provider; role: 'alternate'; attempted: boolean; comparisonState: 'sequential-state' };
export const emptyProviders = (): Record<Provider, ProviderSummary> => ({ core: { availability: 'not-run', searchOutcome: 'not-run', code: 'provider-evidence-unavailable' }, market: { availability: 'not-run', searchOutcome: 'not-run', code: 'provider-evidence-unavailable' } });

/** Fingerprint executable terms; producer timing and tracing do not change a plan. */
export function planDigest(value: Candidate, deployment?: SelectionCapture['deployment']) {
  const observation = new Set(['metrics', 'evaluation', 'diagnostics', 'quoteDiagnostics', 'refs', 'requestId', 'attemptId', 'correlationId', 'workId', 'observedAt', 'providerAssessments', 'providerCandidates']);
  const terms = (v: unknown): unknown => Array.isArray(v) ? v.map(terms) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([key]) => !observation.has(key)).map(([key, child]) => [key, terms(child)])) : v;
  return semanticDigest({ strategy: value.strategy, side: value.side, mode: value.mode, tokenIn: value.tokenIn, tokenOut: value.tokenOut,
    quotedInput: value.quotedInput, quotedOutput: value.quotedOutput, inputMaximum: value.inputMaximum, outputMinimum: value.outputMinimum,
    context: terms(value.context), providerRequest: terms(value.providerRequest), providerQuote: terms(value.providerQuote), deployment });
}
export function providerSummaries(value: Partial<ProviderQuote>, deployment?: SelectionCapture['deployment']): Record<Provider, ProviderSummary> {
  const result = emptyProviders();
  for (const provider of ['core', 'market'] as const) {
    const assessment = value.providerAssessments?.[provider], candidate = value.providerCandidates?.[provider];
    if (assessment) result[provider] = { availability: assessment.availability, searchOutcome: assessment.searchOutcome,
      ...(assessment.code ? { code: assessment.code } : {}) };
    if (candidate && assessment?.availability === 'qualified') result[provider] = { ...result[provider],
      refs: diagnosticReferences(candidate.providerQuote), context: candidate.context, planDigest: planDigest(candidate, deployment),
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
  return { captured, primary: { selectedProvider: quote.strategy, planDigest: planDigest(quote.providerCandidates?.[quote.strategy] ?? quote, captured.deployment),
    bounds: { quotedInput: quote.quotedInput, quotedOutput: quote.quotedOutput, inputMaximum: quote.inputMaximum, outputMinimum: quote.outputMinimum }, context: quote.context, deployment: captured.deployment,
    providers: providerSummaries(quote, captured.deployment), refs: { ...diagnosticReferences(quote.providerQuote), ...safeDiagnosticReferences(captured.diagnostics) } }, alternate: quote.providerCandidates?.[quote.strategy === 'core' ? 'market' : 'core'] };
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
  page: Page, owner: `0x${string}`, config: ProtocolConfiguration, fetcher: typeof fetch, execute?: typeof import('./walletExecution.ts').executeScenario, predecessorDisposition?: ScenarioResult['transactionDisposition']): Promise<AlternateExecution> {
  const { alternate } = captureSelection(capture);
  let result = notAttemptedAlternate(scenario, capture.quote);
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

export function executionCoverage(rows: readonly ScenarioResult[]) {
  const count = (values: { status: string }[]) => Object.fromEntries(['pass', 'fail', 'unavailable', 'skipped'].map(status => [status, values.filter(v => v.status === status).length]));
  const alternates = rows.flatMap(row => row.alternateExecution ? [row.alternateExecution] : []);
  return { scenarios: rows.length, providerAssessments: rows.reduce((n, row) => n + Object.keys(row.providers ?? {}).length, 0),
    uiAttempted: rows.filter(row => row.executionAttempted).length, ui: count([...rows]),
    alternateAttempted: alternates.filter(row => row.attempted).length, alternate: count(alternates),
    alternateNotAttempted: alternates.filter(row => !row.attempted).length };
}

/** Absence of a hash does not establish that a wallet submitted nothing. */
export function transactionDisposition(result: Pick<ScenarioResult, 'status' | 'transactionHash' | 'executionAttempted' | 'executionStage' | 'walletRequestErrorCode'>): NonNullable<ScenarioResult['transactionDisposition']> {
  if (result.status === 'pass' && result.executionAttempted) return 'confirmed';
  if (result.transactionHash) return ['execution-receipt-assertions', 'ui-receipt-assertions', 'ui-balance-postchecks'].includes(result.executionStage ?? '') ? 'confirmed' : 'unknown';
  if (!result.executionAttempted || result.walletRequestErrorCode === 4001) return 'not-submitted';
  const stage = result.executionStage;
  if (!stage || stage.startsWith('setup-') || stage.startsWith('ui-prepare') || ['ui-facts', 'ui-balances', 'execution-facts', 'execution-quote', 'execution-plan', 'authorization-availability', 'allowance-read', 'approval-submission', 'approval-confirmation', 'native-permit-read', 'permit2-read', 'authorization-signature', 'execution-simulation', 'execution-encoding'].includes(stage)) return 'not-submitted';
  return 'unknown';
}
