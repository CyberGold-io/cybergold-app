import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DockerQuoterResources, ownedQuoterBenchmark, type OwnedQuoterResources,
  type OwnedQuoterResourceConfiguration } from '../../scripts/owned-quoter-benchmark.ts';
import { runQuoterBenchmark, type QuoterBenchmarkAttempt, type QuoterBenchmarkMeasurement } from '../../tests/trading/quoterBenchmark.ts';

const item = { id: 'tiny-usdt', inputCurrency: '0x'+'1'.repeat(40), outputCurrency: '0x'+'2'.repeat(40), amountRaw: '100000' };
const base = { number: '0x64', hash: '0x'+'a'.repeat(64), timestamp: '0x64' };
class Controls implements OwnedQuoterResources {
  events: string[] = []; ready = new Set<string>(); records = new Set<string>(); changed = false; failPrime = false;
  async restoreFork() { this.events.push('fork:restore'); this.changed = false; return base; }
  async advanceFork(timestamp: number) { this.events.push('fork:mine:'+timestamp); this.changed = true;
    return { number: '0x65', hash: '0x'+'b'.repeat(64), timestamp: '0x65' }; }
  async resetDatabase(variant: string) { this.events.push('database:reset:'+variant); this.records.delete(variant); this.ready.delete(variant); }
  async restartApi(variant: string, secondary = false) { this.events.push('api:restart:'+variant+(secondary ? ':secondary' : '')); this.ready.add(variant); }
  async ensureApi(variant: string) { this.events.push('api:ensure:'+variant); if (!this.ready.has(variant)) await this.restartApi(variant); }
  async quote(attempt: QuoterBenchmarkAttempt, refresh: boolean, secondary = false): Promise<QuoterBenchmarkMeasurement> {
    this.events.push(`quote:${attempt.variant}:${refresh}:${secondary}`);
    if (this.failPrime) { this.failPrime = false; throw new Error('synthetic prime failure'); }
    const lookup = attempt.variant === 'candidate' && !refresh && this.records.has(attempt.variant);
    this.records.add(attempt.variant);
    return { operation: lookup ? 'lookup' : 'search', requiredFundingRaw: item.amountRaw, netOutputRaw: '123',
      blockNumber: this.changed ? '101' : '100', blockHash: this.changed ? '0x'+'b'.repeat(64) : base.hash };
  }
  async close() { this.events.push('close'); }
}

test('owned phase executes real control operations and separates baseline search from candidate shared hit', async () => {
  const resources = new Controls();
  const report = await runQuoterBenchmark(ownedQuoterBenchmark(resources, [item], 1));
  assert.equal(report.profile, 'mainnet-fork-execution');
  assert.equal(report.rows.length, 10);
  assert.ok(report.rows.every(row => row.status === 'pass'));
  assert.ok(resources.events.includes('database:reset:baseline'));
  assert.ok(resources.events.includes('database:reset:candidate'));
  assert.ok(resources.events.includes('api:restart:candidate:secondary'));
  assert.ok(resources.events.includes('fork:mine:101'));
  const cold = report.rows.find(row => row.condition === 'application-cold' && row.variant === 'candidate')!;
  assert.ok(cold.cache!.reset.includes('sdk-worker'));
  assert.ok(cold.cache!.reset.includes('pool-state'));
  const processWarm = report.rows.find(row => row.condition === 'process-cold-database-warm' && row.variant === 'candidate')!;
  assert.ok(processWarm.cache!.reset.includes('rpc-reads'));
  assert.ok(processWarm.cache!.preserved.includes('completed-quotes'));
  const shared = report.rows.filter(row => row.condition === 'shared-quote-hit');
  assert.deepEqual(shared.map(row => row.result!.operation), ['search', 'lookup']);
  assert.ok(shared.every(row => row.cache!.reset.includes('api-process') && row.cache!.reset.includes('sdk-worker')
    && !row.cache!.preserved.includes('api-process') && row.cache!.preserved.includes('pool-state')));
  assert.ok(report.rows.filter(row => row.condition === 'warm-changed-state').every(row => row.cache!.blockNumber === '101'));
});

test('failed warm-up is recorded and the actual warmed retry is still measured', async () => {
  const resources = new Controls(); resources.failPrime = true;
  const definition = ownedQuoterBenchmark(resources, [item], 1);
  const attempt: QuoterBenchmarkAttempt = { case: item, condition: 'warm-search', repetition: 0, variant: 'candidate' };
  const receipt = await definition.prepare(attempt) as Awaited<ReturnType<typeof definition.prepare>> & { priming: string };
  assert.equal(receipt.priming, 'failed');
  const measured = await definition.measure(attempt);
  assert.equal(measured.operation, 'search');
  assert.equal(resources.events.filter(value => value === 'quote:candidate:true:false').length, 2);
});

test('failed 503 quote preserves only its bounded public code and status in checkpoints', async () => {
  const resources = new Controls();
  resources.quote = async () => { throw Object.assign(new Error('Bearer private-provider-material'), {
    code: 'quote-no-route', httpStatus: 503, requestBody: 'private-provider-material' }); };
  const definition = ownedQuoterBenchmark(resources, [item], 1);
  definition.conditions = ['application-cold'];
  const report = await runQuoterBenchmark(definition);
  assert.ok(report.rows.every(row => row.status === 'fail' && row.apiCode === 'quote-no-route' && row.httpStatus === 503));
  assert.ok(report.rows.every(row => row.code === 'quote-failed' && !row.producerFailureTimings));
  assert.ok(!JSON.stringify(report).includes('private-provider-material'));
  resources.quote = async () => { throw Object.assign(new Error('private'), { code: 'quote-timeout', httpStatus: 503 }); };
  const timeout = await runQuoterBenchmark(definition);
  assert.ok(timeout.rows.every(row => row.code === 'timeout' && row.apiCode === 'quote-timeout'));
  resources.quote = async () => { throw Object.assign(new Error('private-provider-material'), {
    code: 'quote-no-route', httpStatus: 503, metrics: { selectionReason: 'timeout', searchMs: 15000, totalMs: 15001,
      ownedCandidatesStarted: 3, ownedCandidatesCompleted: 0, privateProvider: 'private-provider-material' } }); };
  const exhausted = await runQuoterBenchmark(definition);
  assert.ok(exhausted.rows.every(row => row.code === 'timeout' && row.apiCode === 'quote-no-route'
    && row.producerFailureTimings?.searchMs === 15000 && row.producerFailureTimings?.ownedCandidatesStarted === 3
    && row.producerFailureTimings?.timeToFirstWholePlanMs === undefined));
  assert.ok(!JSON.stringify(exhausted).includes('private-provider-material'));
});

test('Docker controls reset only owned databases, migrate before API startup, and use metrics for readiness', async () => {
  const commands: { args: string[]; input?: string }[] = [], paths: string[] = [], envFiles: string[] = [];
  let block = { ...base }, snapshot = 0, port = 19000, quoteFailure = false;
  const configuration: OwnedQuoterResourceConfiguration = { baselineImage: 'baseline-fixture', candidateImage: 'candidate-fixture',
    forkUrl: 'http://owned-fork.invalid', backendForkUrl: 'http://owned-backend-fork.invalid', chainId: 1,
    core: item.outputCurrency, helpers: '0x'+'3'.repeat(40), routingAdapter: '0x'+'4'.repeat(40),
    postgresImage: 'postgres-fixture', cases: [item] };
  const request: typeof fetch = async (url, init) => {
    const path = String(url); paths.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === configuration.forkUrl) {
      let result: unknown;
      if (body.method === 'evm_snapshot') result = String(++snapshot);
      else if (body.method === 'evm_revert') { block = { ...base }; result = true; }
      else if (body.method === 'evm_mine') { block = { number: '0x65', hash: '0x'+'b'.repeat(64), timestamp: '0x65' }; result = '0x0'; }
      else result = block;
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    }
    if (path.endsWith('/metrics')) return new Response('fixture metrics');
    if (quoteFailure) return Response.json({ code: 'quote-no-route', error: 'private-provider-material' }, { status: 503,
      headers: { 'x-cybergold-owned-quote-metrics': JSON.stringify({ searchMs: 15000, totalMs: 15001, selectionReason: 'timeout',
        ownedCandidatesStarted: 2, ownedCandidatesCompleted: 0, privateProvider: 'private-provider-material' }) } });
    return Response.json({ inputs: body.inputs, quotedOutput: '123', context: { blockNumber: '100', blockHash: base.hash },
      plan: { privateCalldata: 'do-not-report' }, secret: 'do-not-report',
      metrics: path.endsWith('/api/economic-quotes') ? { timeToFirstWholePlanMs: 5, searchMs: 8, totalMs: 9 }
        : { firstQualifiedMs: 5 } });
  };
  const resources = new DockerQuoterResources(configuration, { fetch: request, delay: async () => {},
    execute: async (_command, args, input) => {
      commands.push({ args, input });
      const env = args.indexOf('--env-file');
      if (env !== -1) { envFiles.push(args[env+1]); await readFile(args[env+1], 'utf8'); }
      return args[0] === 'inspect' ? String(++port) : '';
    } });
  try {
    await resources.start();
    await resources.resetDatabase('baseline'); await resources.restartApi('baseline');
    await resources.resetDatabase('candidate'); await resources.restartApi('candidate');
    const attempt: QuoterBenchmarkAttempt = { case: item, condition: 'application-cold', repetition: 0, variant: 'baseline' };
    const baseline = await resources.quote(attempt, true);
    const candidate = await resources.quote({ ...attempt, variant: 'candidate' }, true);
    assert.equal(baseline.producerTimings, undefined, 'JSON arrival/legacy alias is not first plan time');
    assert.equal(candidate.producerTimings?.timeToFirstWholePlanMs, 5);
    assert.ok(!JSON.stringify([baseline, candidate]).includes('do-not-report'));
    quoteFailure = true;
    await assert.rejects(resources.quote(attempt, true), (error: unknown) => {
      const value = error as { code: string; httpStatus: number; message: string; metrics: Record<string, unknown> };
      return value.code === 'quote-no-route' && value.httpStatus === 503 && value.metrics.selectionReason === 'timeout'
        && value.metrics.ownedCandidatesStarted === 2 && !JSON.stringify(value).includes('private-provider-material')
        && !value.message.includes('private-provider-material');
    });
    const reset = commands.find(row => row.input?.includes('DROP DATABASE IF EXISTS quoter_baseline'))!;
    assert.ok(reset.input?.includes('CREATE DATABASE quoter_baseline'));
    const migration = commands.findIndex(row => row.args.includes('alembic') && row.args.includes('baseline-fixture'));
    const api = commands.findIndex(row => row.args.includes('-p') && row.args.includes('baseline-fixture'));
    assert.ok(migration < api);
    const apiRuns = commands.filter(row => row.args.includes('-p'));
    assert.equal(apiRuns.length, 2);
    assert.ok(apiRuns.every(row => row.args[row.args.indexOf('-p')+1] === '127.0.0.1::3000'));
    assert.equal(commands.filter(row => row.args[0] === 'inspect').length, 2);
    assert.ok(paths.includes('http://127.0.0.1:19001/metrics'));
    assert.ok(paths.includes('http://127.0.0.1:19002/metrics'));
    assert.ok(paths.some(path => path.startsWith('http://127.0.0.1:19001/api/')));
    assert.ok(paths.some(path => path.startsWith('http://127.0.0.1:19002/api/')));
    assert.ok(paths.some(path => path.endsWith('/metrics')));
    assert.ok(!paths.some(path => path.endsWith('/api/protocol/facts') || path.endsWith('/api/protocol/config')));
  } finally { await resources.close(); }
  assert.ok(commands.filter(row => row.args[0] === 'rm').every(row => row.args.some(arg => arg.startsWith('cybergold-quoter-'))));
  await assert.rejects(readFile(envFiles[0], 'utf8'), { code: 'ENOENT' });
});

test('migration failure still cleans created resources and restores the caller-owned fork', async () => {
  const commands: string[][] = [];
  let reverted = false;
  const resources = new DockerQuoterResources({ baselineImage: 'baseline', candidateImage: 'candidate',
    postgresImage: 'postgres-fixture', forkUrl: 'http://owned-fork.invalid', backendForkUrl: 'http://owned-fork.invalid',
    chainId: 1, core: item.outputCurrency, helpers: item.outputCurrency, routingAdapter: item.outputCurrency, cases: [item] }, {
    delay: async () => {},
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === 'evm_revert') reverted = true;
      return Response.json({ result: body.method === 'evm_snapshot' ? '1' : true });
    },
    execute: async (_command, args) => {
      commands.push(args);
      if (args.includes('alembic')) throw new Error('synthetic migration failure');
      return '';
    },
  });
  await resources.start();
  try { await assert.rejects(resources.resetDatabase('candidate'), /synthetic migration failure/); }
  finally { await resources.close(); }
  assert.equal(reverted, true);
  assert.ok(commands.some(args => args[0] === 'rm'));
  assert.ok(commands.some(args => args[0] === 'network' && args[1] === 'rm'));
  assert.ok(!commands.some(args => args.includes('-p')));
});
