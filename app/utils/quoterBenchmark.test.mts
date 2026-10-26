import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { focusedUsdtCases, outputError, quoterProducerTimings, runQuoterBenchmark, summarizeQuoterBenchmark,
  type CacheConditionObservation, type QuoterBenchmarkMeasurement } from '../../tests/trading/quoterBenchmark.ts';
import { activeMatrixTemplates } from '../../tests/trading/matrix.ts';
import { observeScenario } from '../../tests/trading/regression.ts';
import { protocolConfigurationFixture as configuration, tokenAddresses } from '../../tests/fixtures/protocol-configuration.ts';
import type { ProtocolFacts } from './protocolFacts.ts';

const cache: CacheConditionObservation = { reset: ['api-process', 'sdk-worker'], preserved: ['fork-state'],
  blockNumber: '100', blockHash: `0x${'1'.repeat(64)}` };
const measurement: QuoterBenchmarkMeasurement = { operation: 'search', requiredFundingRaw: '100', netOutputRaw: '99',
  blockNumber: cache.blockNumber, blockHash: cache.blockHash,
  producerTimings: { timeToFirstWholePlanMs: 10, searchMs: 50, totalMs: 51, selectionReason: 'best-initial' } };

test('focused USDT raw inputs supplement rather than change the standard operating matrix', () => {
  const count = activeMatrixTemplates().length;
  const cases = focusedUsdtCases(configuration);
  assert.equal(cases.length, 6);
  assert.deepEqual(cases.map(row => row.amountRaw), ['10000', '20000', '40000', '60000', '80000', '100000']);
  assert.equal(new Set(cases.map(row => row.id)).size, 6);
  assert.ok(cases.every(row => row.inputCurrency.toLowerCase() === tokenAddresses.USDT.toLowerCase()));
  assert.equal(activeMatrixTemplates().length, count);
  assert.equal(count, 24);
});

test('raw output errors preserve exact integer deltas independently of value/gas metrics', () => {
  assert.deepEqual(outputError('124', '93'), { deltaRaw: '31', absoluteErrorRaw: '31', relativeErrorPpm: '333333' });
  assert.deepEqual(outputError('90', '100'), { deltaRaw: '-10', absoluteErrorRaw: '10', relativeErrorPpm: '-100000' });
  assert.deepEqual(outputError('5', '0'), { deltaRaw: '5', absoluteErrorRaw: '5', reason: 'zero-reference' });
  const large = 2n ** 200n;
  assert.equal(outputError(String(large + 7n), String(large)).absoluteErrorRaw, '7');
});

test('producer timing remains absent without producer evidence and does not use the old firstQualified alias', () => {
  assert.equal(quoterProducerTimings({ metrics: { firstQualifiedMs: 20, selectionMs: 50 } }), undefined);
  assert.deepEqual(quoterProducerTimings({ metrics: { timeToFirstWholePlanMs: 20, searchMs: 50, totalMs: 55,
    selectionReason: 'first-extension', privateMessage: 'do-not-retain' } }),
  { timeToFirstWholePlanMs: 20, searchMs: 50, totalMs: 55, selectionReason: 'first-extension' });
  assert.deepEqual(quoterProducerTimings({ metrics: { timeToFirstWholePlanMs: -1, searchMs: Infinity, totalMs: 5 } }), { totalMs: 5 });
});

test('serial repetitions await actual reset hooks, exclude setup time and alternate variant order', async () => {
  let now = 0, active = 0;
  const populated = { baseline: false, candidate: false }, calls: string[] = [];
  const input = focusedUsdtCases(configuration)[0], checkpoints: unknown[] = [];
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: [input], conditions: ['application-cold', 'warm-search'], repetitions: 2,
    prepare: async attempt => {
      assert.equal(active, 0, 'previous measurement must finish before preparing the next one');
      calls.push(`prepare:${attempt.condition}:${attempt.repetition}:${attempt.variant}`);
      now += 100;
      if (attempt.condition === 'application-cold') populated[attempt.variant] = false;
      attempt.case.amountRaw = 'mutated-by-adapter';
      return { ...cache, reset: attempt.condition === 'application-cold' ? ['api-process'] : [],
        preserved: attempt.condition === 'application-cold' ? ['fork-state'] : ['api-process', 'fork-state'] };
    },
    measure: async attempt => {
      active++;
      assert.equal(attempt.case.amountRaw, input.amountRaw, 'preparation cannot change the recorded request');
      if (attempt.condition === 'application-cold') assert.equal(populated[attempt.variant], false);
      else assert.equal(populated[attempt.variant], true);
      populated[attempt.variant] = true;
      await Promise.resolve(); now += 7; active--;
      calls.push(`measure:${attempt.condition}:${attempt.repetition}:${attempt.variant}`);
      return measurement;
    }, checkpoint: async state => { checkpoints.push(state); },
  }, () => now);
  assert.equal(report.rows.length, 8);
  assert.ok(report.rows.every(row => row.status === 'pass' && row.setupMs === 100 && row.clientRequestMs === 7));
  assert.deepEqual(report.rows.slice(0, 4).map(row => row.variant), ['baseline', 'candidate', 'candidate', 'baseline']);
  assert.equal(checkpoints.length, 8);
  assert.equal((checkpoints[0] as {rows: unknown[]}).rows.length, 1, 'checkpoints are detached snapshots');
  assert.match(calls[0], /^prepare:/); assert.match(calls[1], /^measure:/);
});

test('failed setup is not measured; a timed-out quote remains in totals rather than a successful latency sample', async () => {
  let now = 0;
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: focusedUsdtCases(configuration).slice(0, 1), conditions: ['application-cold'], repetitions: 2,
    prepare: async attempt => {
      now += 100;
      if (attempt.repetition === 0 && attempt.variant === 'baseline') throw new Error('private setup details');
      return cache;
    }, measure: async attempt => {
      now += 15;
      if (attempt.repetition === 0) throw new DOMException('private provider details', 'TimeoutError');
      return { ...measurement, estimateOutputRaw: '100', exactRouteOutputRaw: '99', referenceOutputRaw: '110' };
    },
  }, () => now);
  assert.equal(report.rows[0].code, 'preparation-failed');
  assert.equal(report.rows[0].errorClass, 'Error');
  assert.equal(report.rows[0].clientRequestMs, undefined);
  assert.equal(report.rows[1].code, 'timeout'); assert.equal(report.rows[1].clientRequestMs, 15);
  assert.equal(report.rows[1].errorClass, 'TimeoutError');
  assert.equal(report.rows[2].estimateError?.deltaRaw, '1'); assert.equal(report.rows[2].referenceGap?.deltaRaw, '-11');
  const summary = summarizeQuoterBenchmark(report);
  assert.deepEqual(summary.map(row => [row.attempts, row.completed, row.failed]), [[2, 1, 1], [2, 1, 1]]);
  assert.deepEqual(summary.map(row => row.search.samples), [1, 1]);
  assert.equal(summary[1].timeouts, 1);
  assert.doesNotMatch(JSON.stringify(report), /private setup|private provider/);
});

test('warm completed quote hits and warm full searches have distinct distributions', async () => {
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: focusedUsdtCases(configuration).slice(0, 1), conditions: ['shared-quote-hit'], repetitions: 1,
    prepare: async () => cache, measure: async attempt => ({ ...measurement, operation: attempt.variant === 'baseline' ? 'search' : 'lookup' }),
  });
  const summary = summarizeQuoterBenchmark(report);
  assert.equal(summary[0].search.samples, 1); assert.equal(summary[0].lookup.samples, 0);
  assert.equal(summary[1].search.samples, 0); assert.equal(summary[1].lookup.samples, 1);
});

test('active exact-input JSON observation retains producer timing separately from client duration', async () => {
  const facts = { basket: { assets: { status: 'success', value: [] }, targetsPpm: { status: 'success', value: [] } } } as unknown as ProtocolFacts;
  const scenario = { ...activeMatrixTemplates().find(row => row.asset === 'USDC' && row.side === 'buy')!, amountRaw: '100000' };
  const fetcher = (async (_path, init) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ operation: 'executeExactInput', plan: { ...request, body: '0x', minimumOutput: '99' },
      outputMinimum: '99', quotedOutput: '100', fees: { coreProtocolFeeCygld: '0', coreHelpersFeeCygld: '0', marketFeeCygld: '0' },
      context: { chainId: configuration.chainId, blockNumber: '100', blockHash: cache.blockHash }, routeFamily: 'market',
      deployment: { helpers: configuration.contracts.helpers, adapter: configuration.contracts.uniswapAdapter }, metrics: {
        timeToFirstWholePlanMs: 15, searchMs: 50, totalMs: 52, selectionReason: 'best-initial' } }));
  }) as typeof fetch;
  const result = (await observeScenario(scenario, configuration, facts, fetcher)).result;
  assert.equal(result.status, 'pass'); assert.equal(typeof result.durationMs, 'number');
  assert.equal(result.firstExecutableMs, undefined, 'JSON arrival must not become a first-plan timestamp');
  assert.deepEqual(result.producerTimings, { timeToFirstWholePlanMs: 15, searchMs: 50, totalMs: 52, selectionReason: 'best-initial' });
});

test('benchmark CLI runs the adapter hooks and writes a report before closing owned resources', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'quoter-benchmark-'));
  try {
    const marker = join(folder, 'closed'), report = join(folder, 'report.json'), adapter = join(folder, 'adapter.mjs');
    await writeFile(adapter, `import {writeFile} from 'node:fs/promises';
export const benchmark={profile:'mainnet-fork-execution',cases:[{id:'tiny',inputCurrency:'input',outputCurrency:'output',amountRaw:'1'}],conditions:['application-cold'],repetitions:1,
prepare:async()=>(${JSON.stringify(cache)}),measure:async()=>(${JSON.stringify(measurement)})};
export const close=()=>writeFile(${JSON.stringify(marker)},'closed');`);
    const cli = fileURLToPath(new URL('../../scripts/run-quoter-benchmark.mts', import.meta.url));
    const child = spawnSync(process.execPath, [cli, '--adapter', adapter, '--output', report], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const value = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(value.rows.length, 2); assert.equal(value.summary.length, 2);
    assert.equal(await readFile(marker, 'utf8'), 'closed');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('benchmark CLI closes adapter resources when report directory creation fails', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'quoter-benchmark-cleanup-'));
  try {
    const marker = join(folder, 'closed'), blocker = join(folder, 'regular-file'), adapter = join(folder, 'adapter.mjs');
    await writeFile(blocker, 'not a directory');
    await writeFile(adapter, `import {writeFile} from 'node:fs/promises';
export const benchmark={};
export const close=()=>writeFile(${JSON.stringify(marker)},'closed');`);
    const cli = fileURLToPath(new URL('../../scripts/run-quoter-benchmark.mts', import.meta.url));
    const child = spawnSync(process.execPath, [cli, '--adapter', adapter, '--output', join(blocker, 'report.json')], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.equal(await readFile(marker, 'utf8'), 'closed');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
