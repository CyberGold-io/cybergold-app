import assert from 'node:assert/strict';
import test from 'node:test';
import { DockerQuoterResources, type OwnedQuoterResourceConfiguration } from '../../scripts/owned-quoter-benchmark.ts';
import { runQuoterBenchmark, summarizeQuoterBenchmark, type QuoterBenchmarkAccuracy, type QuoterBenchmarkMeasurement } from '../../tests/trading/quoterBenchmark.ts';

const blockHash = '0x'+'a'.repeat(64);
const item = { id: 'usdt-held-out', inputCurrency: '0x'+'1'.repeat(40), outputCurrency: '0x'+'2'.repeat(40), amountRaw: '1000' };
const measured: QuoterBenchmarkMeasurement = { operation: 'search', requiredFundingRaw: '1000', netOutputRaw: '100',
  blockNumber: '100', blockHash };
const observation = (): QuoterBenchmarkAccuracy => ({ cohort: 'fresh-secondary-whole-trade',
  estimate: { status: 'available', outputRaw: '110', strategy: 'market', blockNumber: '100', blockHash },
  reference: { status: 'available', initialSeconds: 30, extensionSeconds: 10,
    quote: { ...measured, netOutputRaw: '125' }, coverage: { scope: 'selected-inventory', candidatesCompleted: 12 } } });

test('accuracy runs after every primary pair, outside request time, with whole-trade errors only', async () => {
  let now = 0;
  const events: string[] = [];
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: [item], conditions: ['application-cold'], repetitions: 1,
    prepare: async () => { now += 2; return { reset: [], preserved: [], blockNumber: '100', blockHash }; },
    measure: async attempt => { events.push('measure:'+attempt.variant); now += 10; return measured; },
    accuracy: async attempt => {
      assert.deepEqual(events.slice(0, 2), ['measure:baseline', 'measure:candidate']);
      events.push('accuracy:'+attempt.variant); now += 1000; return observation();
    },
  }, () => now);
  assert.deepEqual(report.rows.map(row => row.clientRequestMs), [10, 10]);
  assert.deepEqual(report.rows.map(row => row.accuracyMs), [1000, 1000]);
  assert.ok(report.rows.every(row => row.status === 'pass'));
  assert.equal(report.rows[0].accuracy?.wholeTradeEstimateError?.deltaRaw, '10');
  assert.equal(report.rows[0].accuracy?.referenceGap?.deltaRaw, '-25');
  assert.equal(report.rows[0].accuracy?.estimateComparison, 'same-state-whole-trade');
  assert.equal(report.rows[0].estimateError, undefined, 'different selected routes are not a same-route estimator cohort');
  assert.equal(summarizeQuoterBenchmark(report)[0].accuracy?.meanAbsoluteErrorPpm, '100000');
});

test('accuracy failure/unavailability never replaces primary success or leaks provider prose', async () => {
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: [item], conditions: ['warm-search'], repetitions: 1,
    prepare: async () => ({ reset: [], preserved: [], blockNumber: '100', blockHash }), measure: async () => measured,
    accuracy: async attempt => {
      if (attempt.variant === 'baseline') throw Object.assign(new Error('Bearer private-provider-material'), { code: 'quote-no-route', httpStatus: 503 });
      return { cohort: 'fresh-secondary-whole-trade', estimate: { status: 'unavailable' },
        reference: { status: 'failed', initialSeconds: 30, extensionSeconds: 10, failure: { apiCode: 'quote-timeout', httpStatus: 503 } } };
    },
  });
  assert.ok(report.rows.every(row => row.status === 'pass'));
  assert.equal(report.rows[0].accuracyFailure?.apiCode, 'quote-no-route');
  assert.equal(report.rows[1].accuracy?.reference.status, 'failed');
  assert.equal(report.rows[1].accuracy?.wholeTradeEstimateError, undefined);
  assert.ok(!JSON.stringify(report).includes('private-provider-material'));
});

test('different or unknown observation states retain quantities without fabricated accuracy errors', async () => {
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: [item], conditions: ['shared-quote-hit'], repetitions: 1,
    prepare: async () => ({ reset: [], preserved: [], blockNumber: '100', blockHash }), measure: async () => measured,
    accuracy: async attempt => {
      const result = observation();
      result.estimate.blockHash = attempt.variant === 'baseline' ? '0x'+'b'.repeat(64) : undefined;
      result.reference.quote!.blockHash = '0x'+'b'.repeat(64);
      return result;
    },
  });
  assert.deepEqual(report.rows.map(row => row.accuracy?.estimateComparison), ['different-state', 'unknown-state']);
  assert.ok(report.rows.every(row => row.accuracy?.wholeTradeEstimateError === undefined && row.accuracy?.referenceGap === undefined));
});

test('a failed primary may still collect a successful reference without becoming a successful primary', async () => {
  const report = await runQuoterBenchmark({ profile: 'mainnet-fork-execution', cases: [item], conditions: ['application-cold'], repetitions: 1,
    prepare: async () => ({ reset: [], preserved: [], blockNumber: '100', blockHash }),
    measure: async attempt => { if (attempt.variant === 'baseline') throw new Error('no primary result'); return measured; },
    accuracy: async (attempt, primary) => {
      assert.equal(primary === undefined, attempt.variant === 'baseline');
      return observation();
    },
  });
  assert.equal(report.rows[0].status, 'fail');
  assert.equal(report.rows[0].accuracy?.reference.status, 'available');
  assert.equal(report.rows[0].accuracy?.referenceGap, undefined);
  assert.equal(report.rows[1].status, 'pass');
});

test('owned accuracy secondary copies facts into isolated DB, estimates first, then requests longer reference', async () => {
  const commands: { args: string[]; input?: string }[] = [], requests: { path: string; reference: boolean }[] = [];
  let port = 20000;
  const freshContext = { blockNumber: '101', blockHash: '0x'+'b'.repeat(64) };
  let sourceContext: typeof freshContext | null = freshContext;
  const config: OwnedQuoterResourceConfiguration = { baselineImage: 'baseline', candidateImage: 'candidate',
    postgresImage: 'postgres-fixture', forkUrl: 'http://owned-fork.invalid', backendForkUrl: 'http://owned-fork.invalid',
    chainId: 1, core: item.outputCurrency, helpers: item.outputCurrency, routingAdapter: item.outputCurrency, cases: [item] };
  const resources = new DockerQuoterResources(config, { freePort: async () => ++port, delay: async () => {},
    execute: async (_command, args, input) => { commands.push({ args, input }); return ''; },
    fetch: async (url, init) => {
      const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === config.forkUrl) return Response.json({ result: body.method === 'evm_snapshot' ? '1'
        : body.method === 'eth_getBlockByNumber' ? { number: '0x64', hash: blockHash, timestamp: '0x64' } : true });
      if (path.endsWith('/metrics')) return new Response('in-memory metrics');
      const reference = new Headers(init?.headers).get('X-CyberGold-Owned-Quote-Mode') === 'reference';
      requests.push({ path, reference });
      if (path.endsWith('/api/economic-estimates')) return Response.json({ estimate: { strategy: 'market', amount: '110' },
        models: [{ strategy: 'market', value: { context: { blockNumber: '100', blockHash }, routes: [{ sourceContext }] } }] });
      return Response.json({ inputs: body.inputs, quotedOutput: reference ? '125' : '100', plan: { privateCalldata: 'do-not-report' },
        context: { blockNumber: '100', blockHash }, searchCoverage: { scope: 'selected-inventory', coreSharesPercent: [0, 100], orders: ['core-first'] },
        metrics: { timeToFirstWholePlanMs: 3, totalMs: 10, ownedCandidatesStarted: 16, ownedCandidatesCompleted: 12, ownedQualifiedUpdates: 4 } });
    } });
  await resources.start();
  try {
    await resources.resetDatabase('candidate'); await resources.restartApi('candidate');
    const attempt = { case: item, condition: 'application-cold' as const, repetition: 0, variant: 'candidate' as const };
    await resources.quote(attempt, true);
    const accuracy = await resources.accuracy(attempt);
    assert.equal(accuracy.estimate.outputRaw, '110');
    assert.equal(accuracy.estimate.blockHash, freshContext.blockHash, 'refreshed route sources take priority over stale packet context');
    assert.equal(accuracy.reference.quote?.netOutputRaw, '125');
    assert.equal(accuracy.reference.coverage?.candidatesCompleted, 12);
    assert.equal(accuracy.reference.quote?.producerTimingScope, 'current-search');
    assert.deepEqual(requests.map(row => [row.path.endsWith('/api/economic-estimates'), row.reference]), [[false, false], [true, false], [false, true]]);
    assert.ok(requests[1].path.startsWith('http://127.0.0.1:20002'));
    assert.ok(commands.some(row => row.input?.includes('CREATE DATABASE quoter_candidate_accuracy')));
    assert.ok(commands.some(row => row.args.includes('--copy-canonical-facts') && row.args.includes('quoter_candidate_accuracy')));
    assert.ok(commands.filter(row => row.args.includes('-p')).every(row => row.args.some(arg => arg.includes('owned-quoter-runtime.py,readonly'))));
    assert.ok(!JSON.stringify(accuracy).includes('do-not-report'));
    await resources.quote(attempt, true);
    assert.equal(requests.at(-1)!.reference, false, 'reference header does not persist onto ordinary calls');
    sourceContext = null;
    assert.equal((await resources.accuracy(attempt)).estimate.blockHash, undefined, 'mixed route facts cannot borrow packet context');
  } finally { await resources.close(); }
});
