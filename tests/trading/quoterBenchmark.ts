import { parseUnits } from 'viem';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import { configuredToken } from './scenarios.ts';
import { repetitionManifest } from './matrix.ts';
import { quoteErrorKeys } from '../../app/utils/quoteErrors.ts';

export type QuoterBenchmarkApiFailure = { httpStatus?: number; apiCode?: keyof typeof quoteErrorKeys };
/** Failure reports keep recognized public codes/status, never upstream prose. */
export function quoterBenchmarkApiFailure(error: unknown): QuoterBenchmarkApiFailure {
  const value = error as { httpStatus?: unknown; code?: unknown } | null;
  const result: QuoterBenchmarkApiFailure = {};
  if (typeof value?.httpStatus === 'number' && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)
    result.httpStatus = value.httpStatus;
  if (typeof value?.code === 'string' && Object.hasOwn(quoteErrorKeys, value.code)) result.apiCode = value.code as keyof typeof quoteErrorKeys;
  return result;
}

export type QuoterProducerTimings = {
  timeToFirstWholePlanMs?: number; searchMs?: number; totalMs?: number; selectionReason?: string;
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
  if (typeof metrics.selectionReason === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(metrics.selectionReason))
    result.selectionReason = metrics.selectionReason;
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
  estimateOutputRaw?: string; exactRouteOutputRaw?: string; referenceOutputRaw?: string;
  rpcIssued?: number; rpcReused?: number;
};
export type QuoterBenchmarkRow = QuoterBenchmarkAttempt & {
  status: 'pass' | 'fail'; stage: 'prepare' | 'measure'; cache?: CacheConditionObservation;
  setupMs: number; clientRequestMs?: number; result?: QuoterBenchmarkMeasurement;
  code?: 'preparation-failed' | 'quote-failed' | 'timeout';
  httpStatus?: QuoterBenchmarkApiFailure['httpStatus']; apiCode?: QuoterBenchmarkApiFailure['apiCode'];
  errorClass?: 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'AbortError' | 'TimeoutError';
  estimateError?: OutputError; referenceGap?: OutputError;
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
          Object.assign(row, quoterBenchmarkApiFailure(error));
          row.code = ['AbortError', 'TimeoutError'].includes(row.errorClass) || row.apiCode === 'quote-timeout' || row.apiCode === 'rpc-timeout' ? 'timeout'
            : row.stage === 'prepare' ? 'preparation-failed' : 'quote-failed';
        }
        report.rows.push(row);
        await definition.checkpoint?.(structuredClone(report));
      }
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
    return { key, attempts: rows.length, completed: completed.length, failed: rows.length - completed.length,
      timeouts: rows.filter(row => row.code === 'timeout').length, search: distribution('search'), lookup: distribution('lookup') };
  });
}
