import { parseUnits } from 'viem';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import { configuredToken } from './scenarios.ts';
import { repetitionManifest } from './matrix.ts';
import { quoteErrorKeys } from '../../app/utils/quoteErrors.ts';

export type QuoterBenchmarkApiFailure = {
  httpStatus?: number; apiCode?: keyof typeof quoteErrorKeys; producerTimings?: QuoterProducerTimings;
};
/** Failure reports keep recognized public codes/status, never upstream prose. */
export function quoterBenchmarkApiFailure(error: unknown): QuoterBenchmarkApiFailure {
  const value = error as { httpStatus?: unknown; code?: unknown } | null;
  const result: QuoterBenchmarkApiFailure = {};
  if (typeof value?.httpStatus === 'number' && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)
    result.httpStatus = value.httpStatus;
  if (typeof value?.code === 'string' && Object.hasOwn(quoteErrorKeys, value.code)) result.apiCode = value.code as keyof typeof quoteErrorKeys;
  const timings = quoterProducerTimings(error);
  if (timings) result.producerTimings = timings;
  return result;
}

export type QuoterProducerTimings = {
  timeToFirstWholePlanMs?: number; searchMs?: number; totalMs?: number; selectionReason?: string;
  ownedQualifiedUpdates?: number; ownedCandidatesStarted?: number; ownedCandidatesCompleted?: number;
};

/** Optional producer observations. Never infer first-plan time from JSON arrival. */
export function quoterProducerTimings(value: unknown): QuoterProducerTimings | undefined {
  const metrics = (value as { metrics?: Record<string, unknown> } | null)?.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const result: QuoterProducerTimings = {};
  for (const key of ['timeToFirstWholePlanMs', 'searchMs', 'totalMs'] as const) {
    const number = metrics[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) result[key] = number;
  }
  if (typeof metrics.selectionReason === 'string' && ['complete', 'best-initial', 'first-extension', 'timeout'].includes(metrics.selectionReason))
    result.selectionReason = metrics.selectionReason;
  for (const key of ['ownedQualifiedUpdates', 'ownedCandidatesStarted', 'ownedCandidatesCompleted'] as const) {
    const count = metrics[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  return Object.keys(result).length ? result : undefined;
}

export type QuoterBenchmarkCase = { id: string; inputCurrency: string; outputCurrency: string; amountRaw: string };
export const focusedUsdtAmounts = ['0.01', '0.02', '0.04', '0.06', '0.08', '0.10'] as const;

/** Explicit raw inputs; does not alter the existing 24-journey operating matrix. */
export function focusedUsdtCases(configuration: ProtocolConfiguration): QuoterBenchmarkCase[] {
  const input = configuredToken(configuration, 'USDT');
  const output = configuredToken(configuration, 'CYGLD');
  if (input.type !== 'erc20' || output.type !== 'erc20') throw new Error('benchmark-token-type');
  return focusedUsdtAmounts.map(amount => ({ id: `quoter-usdt-${amount.replace('.', '-')}`,
    inputCurrency: input.address, outputCurrency: output.address, amountRaw: String(parseUnits(amount, input.decimals)) }));
}

export type OutputError = { deltaRaw: string; absoluteErrorRaw: string; relativeErrorPpm?: string; reason?: 'zero-reference' };
/** Compare like-for-like token coordinates, independently of USD/gas efficiency. */
export function outputError(predictedRaw: string, referenceRaw: string): OutputError {
  const reference = BigInt(referenceRaw), delta = BigInt(predictedRaw) - reference;
  return { deltaRaw: String(delta), absoluteErrorRaw: String(delta < 0n ? -delta : delta),
    ...(reference === 0n ? { reason: 'zero-reference' as const } : { relativeErrorPpm: String(delta * 1_000_000n / reference) }) };
}

export type QuoterBenchmarkCondition = 'application-cold' | 'process-cold-database-warm' | 'warm-search'
  | 'shared-quote-hit' | 'warm-changed-state';
export type CacheResource = 'api-process' | 'sdk-worker' | 'rpc-reads' | 'pool-catalog' | 'pool-state'
  | 'completed-quotes' | 'fast-models' | 'fork-state' | 'wallet-fixture';
export type CacheConditionObservation = {
  reset: CacheResource[]; preserved: CacheResource[];
  blockNumber: string; blockHash: string;
};
export type QuoterBenchmarkAttempt = {
  case: QuoterBenchmarkCase; condition: QuoterBenchmarkCondition; repetition: number; variant: 'baseline' | 'candidate';
};
export type QuoterBenchmarkMeasurement = {
  operation: 'search' | 'lookup'; requiredFundingRaw: string; netOutputRaw: string;
  blockNumber: string; blockHash: string; routeId?: string; producerTimings?: QuoterProducerTimings;
  producerTimingScope?: 'current-search' | 'stored-observation';
  estimateOutputRaw?: string; exactRouteOutputRaw?: string; referenceOutputRaw?: string;
  rpcIssued?: number; rpcReused?: number;
};
export type QuoterReferenceCoverage = {
  scope?: 'selected-inventory'; coreSharesPercent?: number[]; orders?: string[];
  maxCoreInvocations?: number; maxAmmHops?: number;
  candidatesStarted?: number; candidatesCompleted?: number; qualifiedUpdates?: number;
};
export type QuoterBenchmarkAccuracy = {
  cohort: 'fresh-secondary-whole-trade';
  estimate: { status: 'available' | 'unavailable' | 'failed'; outputRaw?: string; strategy?: 'core' | 'market';
    blockNumber?: string; blockHash?: string; failure?: QuoterBenchmarkApiFailure };
  reference: { status: 'available' | 'failed'; quote?: QuoterBenchmarkMeasurement;
    coverage?: QuoterReferenceCoverage; failure?: QuoterBenchmarkApiFailure;
    initialSeconds: number; extensionSeconds: number };
  estimateComparison?: 'same-state-whole-trade' | 'different-state' | 'unknown-state';
  referenceComparison?: 'same-state-whole-trade' | 'different-state';
  wholeTradeEstimateError?: OutputError; referenceGap?: OutputError;
};
export type QuoterBenchmarkRow = QuoterBenchmarkAttempt & {
  status: 'pass' | 'fail'; stage: 'prepare' | 'measure'; cache?: CacheConditionObservation;
  setupMs: number; clientRequestMs?: number; result?: QuoterBenchmarkMeasurement;
  code?: 'preparation-failed' | 'quote-failed' | 'timeout';
  httpStatus?: QuoterBenchmarkApiFailure['httpStatus']; apiCode?: QuoterBenchmarkApiFailure['apiCode'];
  producerFailureTimings?: QuoterProducerTimings;
  errorClass?: 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'AbortError' | 'TimeoutError';
  estimateError?: OutputError; referenceGap?: OutputError;
  accuracy?: QuoterBenchmarkAccuracy; accuracyMs?: number;
  accuracyFailure?: QuoterBenchmarkApiFailure & { errorClass: string };
};
export type QuoterBenchmarkReport = {
  schema: 'cybergold.quoter-benchmark.v1'; profile: string; repetitions: number; concurrency: 1;
  rows: QuoterBenchmarkRow[];
};
export type QuoterBenchmarkDefinition = {
  profile: string; cases: readonly QuoterBenchmarkCase[]; conditions: readonly QuoterBenchmarkCondition[]; repetitions: number;
  /** The owned-profile orchestrator actually resets/preserves resources before returning this receipt. */
  prepare: (attempt: QuoterBenchmarkAttempt) => Promise<CacheConditionObservation>;
  /** Quote-only observation. Wallet/setup/valuation belongs outside this timer. */
  measure: (attempt: QuoterBenchmarkAttempt) => Promise<QuoterBenchmarkMeasurement>;
  /** Runs after the primary request timer stops, even when that request failed. */
  accuracy?: (attempt: QuoterBenchmarkAttempt, primary?: QuoterBenchmarkMeasurement) => Promise<QuoterBenchmarkAccuracy>;
  checkpoint?: (report: QuoterBenchmarkReport) => Promise<void>;
};

/** Serial paired repetitions; preparation is awaited before starting the request clock. */
export async function runQuoterBenchmark(definition: QuoterBenchmarkDefinition,
  clock: () => number = () => performance.now()): Promise<QuoterBenchmarkReport> {
  repetitionManifest({ repetitions: definition.repetitions, concurrency: 1, condition: 'cold', preserved: [], reset: [] });
  const report: QuoterBenchmarkReport = { schema: 'cybergold.quoter-benchmark.v1', profile: definition.profile,
    repetitions: definition.repetitions, concurrency: 1, rows: [] };
  for (const item of definition.cases) for (const condition of definition.conditions)
    for (let repetition = 0; repetition < definition.repetitions; repetition++) {
      const variants = repetition % 2 ? ['candidate', 'baseline'] as const : ['baseline', 'candidate'] as const;
      for (const variant of variants) {
        const attempt: QuoterBenchmarkAttempt = { case: structuredClone(item), condition, repetition, variant };
        const started = clock();
        const row: QuoterBenchmarkRow = { ...attempt, status: 'fail', stage: 'prepare', setupMs: 0 };
        let requestStarted: number | undefined;
        try {
          row.cache = structuredClone(await definition.prepare(structuredClone(attempt)));
          row.setupMs = clock() - started;
          row.stage = 'measure'; requestStarted = clock();
          row.result = structuredClone(await definition.measure(structuredClone(attempt)));
          row.clientRequestMs = clock() - requestStarted;
          if (row.result.estimateOutputRaw !== undefined && row.result.exactRouteOutputRaw !== undefined)
            row.estimateError = outputError(row.result.estimateOutputRaw, row.result.exactRouteOutputRaw);
          if (row.result.referenceOutputRaw !== undefined)
            row.referenceGap = outputError(row.result.netOutputRaw, row.result.referenceOutputRaw);
          row.status = 'pass';
        } catch (error) {
          if (requestStarted === undefined) row.setupMs = clock() - started;
          else row.clientRequestMs = clock() - requestStarted;
          const name = error instanceof Error ? error.name : 'Error';
          row.errorClass = (['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError'] as const)
            .find(value => value === name) ?? 'Error';
          const { producerTimings, ...failure } = quoterBenchmarkApiFailure(error);
          Object.assign(row, failure);
          if (producerTimings) row.producerFailureTimings = producerTimings;
          row.code = ['AbortError', 'TimeoutError'].includes(row.errorClass) || row.apiCode === 'quote-timeout' || row.apiCode === 'rpc-timeout'
            || producerTimings?.selectionReason === 'timeout' ? 'timeout'
            : row.stage === 'prepare' ? 'preparation-failed' : 'quote-failed';
        }
        report.rows.push(row);
        await definition.checkpoint?.(structuredClone(report));
      }
    }
  // Complete every primary pair before accuracy work can warm shared node state.
  if (definition.accuracy) for (const row of report.rows) {
    if (row.stage !== 'measure') continue;
    const attempt: QuoterBenchmarkAttempt = { case: row.case, condition: row.condition, repetition: row.repetition, variant: row.variant };
    const accuracyStarted = clock();
    try {
      row.accuracy = structuredClone(await definition.accuracy(structuredClone(attempt), structuredClone(row.result)));
      const estimate = row.accuracy.estimate;
      if (estimate.status === 'available' && estimate.outputRaw !== undefined && row.result) {
        row.accuracy.estimateComparison = !estimate.blockHash ? 'unknown-state'
          : estimate.blockHash.toLowerCase() === row.result.blockHash.toLowerCase() ? 'same-state-whole-trade' : 'different-state';
        if (row.accuracy.estimateComparison === 'same-state-whole-trade')
          row.accuracy.wholeTradeEstimateError = outputError(estimate.outputRaw, row.result.netOutputRaw);
      }
      const reference = row.accuracy.reference;
      if (reference.status === 'available' && reference.quote && row.result) {
        row.accuracy.referenceComparison = reference.quote.blockHash.toLowerCase() === row.result.blockHash.toLowerCase()
          ? 'same-state-whole-trade' : 'different-state';
        if (row.accuracy.referenceComparison === 'same-state-whole-trade')
          row.accuracy.referenceGap = outputError(row.result.netOutputRaw, reference.quote.netOutputRaw);
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      row.accuracyFailure = { ...quoterBenchmarkApiFailure(error),
        errorClass: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(name) ? name : 'Error' };
    }
    row.accuracyMs = clock()-accuracyStarted;
    await definition.checkpoint?.(structuredClone(report));
  }
  return report;
}

/** Keep failures/counts visible and lookup/search distributions separate. */
export function summarizeQuoterBenchmark(report: QuoterBenchmarkReport) {
  const groups = new Map<string, QuoterBenchmarkRow[]>();
  for (const row of report.rows) {
    const key = [row.case.id, row.variant, row.condition].join('/');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, rows]) => {
    const completed = rows.filter(row => row.status === 'pass');
    const distribution = (operation: 'search' | 'lookup') => {
      const values = completed.filter(row => row.result?.operation === operation).map(row => row.clientRequestMs!)
        .sort((a, b) => a - b);
      if (!values.length) return { samples: 0 };
      const middle = Math.floor(values.length / 2);
      return { samples: values.length, medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
        minimumMs: values[0], maximumMs: values[values.length - 1] };
    };
    const accuracy = rows.filter(row => row.accuracy !== undefined || row.accuracyFailure !== undefined);
    const errors = accuracy.flatMap(row => row.accuracy?.wholeTradeEstimateError?.relativeErrorPpm === undefined ? []
      : [BigInt(row.accuracy.wholeTradeEstimateError.relativeErrorPpm)]).map(value => value < 0n ? -value : value);
    return { key, attempts: rows.length, completed: completed.length, failed: rows.length - completed.length,
      timeouts: rows.filter(row => row.code === 'timeout').length, search: distribution('search'), lookup: distribution('lookup'),
      ...(accuracy.length ? { accuracy: { attempted: accuracy.length,
        failed: accuracy.filter(row => row.accuracyFailure).length,
        estimateAvailable: accuracy.filter(row => row.accuracy?.estimate.status === 'available').length,
        referenceAvailable: accuracy.filter(row => row.accuracy?.reference.status === 'available').length,
        sameStateWholeTradeErrors: errors.length,
        ...(errors.length ? { meanAbsoluteErrorPpm: String(errors.reduce((a, b) => a+b, 0n)/BigInt(errors.length)),
          worstAbsoluteErrorPpm: String(errors.reduce((a, b) => a > b ? a : b, 0n)) } : {}) } } : {}) };
  });
}
