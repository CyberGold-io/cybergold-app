import { protocolConfigurationValues, type ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import type { TradeQuote, TradeQuoteRequest } from '../../app/utils/tradeQuote.ts';
import type { MatrixScenario } from './matrix.ts';
import type { QuoteObservation } from './quoteObservation.ts';
import type { SelectionCapture } from './providerEvidence.ts';
import { browserQuoteMatcher } from './browserQuoteObservation.ts';
import type { UniversalExactInputQuote } from '../../app/utils/universalExactInput.ts';

export type PrivateSandboxPhase = 'prepare' | 'winner' | 'alternate';
export type SandboxIsolation = {
  source: 'sandbox'; sourceBlockNumber: string; sourceBlockHash: string;
  baselineBlockNumber: string; baselineBlockHash: string; cacheGeneration: number;
  reset: 'snapshot-reverted';
  chain: 'owned-fork'; cache: 'recreated-per-attempt'; wallet: 'fresh-profile-per-attempt';
};
export type ScenarioIsolation = SandboxIsolation & { attemptRole: 'winner' | 'alternate' };

export function scenarioIsolation(isolation: SandboxIsolation, attemptRole: ScenarioIsolation['attemptRole']): ScenarioIsolation {
  return { ...isolation, attemptRole };
}

/** The host orchestrator owns reset operations; the wallet process only records them. */
export function privateSandboxPhase(value: string | undefined): PrivateSandboxPhase | undefined {
  if (!value) return undefined;
  if (value === 'prepare' || value === 'winner' || value === 'alternate') return value;
  throw new Error('private-sandbox-phase-invalid');
}

export function privateSandboxScenarios(scenarios: MatrixScenario[], phase: PrivateSandboxPhase | undefined, identifier?: string) {
  if (!phase || phase === 'prepare') return scenarios;
  const selected = scenarios.filter(scenario => scenario.id === identifier?.replace(/^ui-/, ''));
  // An unknown scenario must not produce a successful empty execution report.
  if (selected.length !== 1) throw new Error('private-sandbox-scenario-unavailable');
  return selected;
}

/** Preserve the original browser request when UI preparation failed before click. */
export function privateSandboxSelection(observations: readonly QuoteObservation[], scenario: MatrixScenario,
  configuration: ProtocolConfiguration): SelectionCapture | undefined {
  if (scenario.inputMode === 'exact-in') {
    const matches = browserQuoteMatcher(scenario, configuration, scenario.amountRaw ?? '0', scenario.basketAssets ?? []);
    const observed = observations.findLast(row => matches(row) && row.terminal?.type === 'complete');
    if (observed) return { universalQuote: structuredClone(observed.terminal!.value as UniversalExactInputQuote),
      deployment: protocolConfigurationValues(configuration).addresses };
  }
  if (scenario.asset === 'BASKET') return undefined;
  const observed = observations.findLast(row => row.path === '/api/quotes/trade/stream'
    && row.request.side === scenario.side && row.request.mode === scenario.inputMode
    && row.request.amount === scenario.amountRaw && row.terminal?.type === 'complete');
  if (!observed) return undefined;
  return { quote: structuredClone(observed.terminal!.value as TradeQuote),
    intent: structuredClone(observed.request as TradeQuoteRequest),
    deployment: protocolConfigurationValues(configuration).addresses };
}

/** Comparisons are isolated only when the producer reports its completed reset. */
export function sandboxIsolation(raw: unknown): SandboxIsolation {
  const value = raw as Partial<SandboxIsolation> | null;
  if (!value || value.source !== 'sandbox') throw new Error('private-sandbox-source-required');
  if (value.reset !== 'snapshot-reverted') throw new Error('private-sandbox-reset-required');
  if (value.chain !== 'owned-fork') throw new Error('private-sandbox-owned-fork-required');
  if (value.cache !== 'recreated-per-attempt') throw new Error('private-sandbox-cache-reset-required');
  if (value.wallet !== 'fresh-profile-per-attempt') throw new Error('private-sandbox-wallet-reset-required');
  for (const field of ['sourceBlockNumber', 'baselineBlockNumber'] as const)
    if (typeof value[field] !== 'string' || !/^(0|[1-9]\d*)$/.test(value[field])) throw new Error(`private-sandbox-${field}-invalid`);
  for (const field of ['sourceBlockHash', 'baselineBlockHash'] as const)
    if (typeof value[field] !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value[field])) throw new Error(`private-sandbox-${field}-invalid`);
  if (!Number.isSafeInteger(value.cacheGeneration) || value.cacheGeneration! < 0) throw new Error('private-sandbox-cache-generation-invalid');
  return { source: 'sandbox', sourceBlockNumber: value.sourceBlockNumber!, sourceBlockHash: value.sourceBlockHash!,
    baselineBlockNumber: value.baselineBlockNumber!, baselineBlockHash: value.baselineBlockHash!, cacheGeneration: value.cacheGeneration!,
    reset: 'snapshot-reverted', chain: 'owned-fork', cache: 'recreated-per-attempt', wallet: 'fresh-profile-per-attempt' };
}
