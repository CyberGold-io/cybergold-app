import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { observeBrowserQuotes } from '../../tests/trading/browserQuotes.ts';
import { activeMatrixTemplates } from '../../tests/trading/matrix.ts';
import { regressionPolicy, unexpectedFailure } from '../../tests/trading/runPolicy.ts';
import type { ScenarioResult } from '../../tests/trading/regression.ts';
import { protocolConfigurationFixture } from '../../tests/fixtures/protocol-configuration.ts';

test('run policy defaults preserve historical full runs and reject invalid explicit choices', () => {
  assert.equal(regressionPolicy(undefined), 'full');
  assert.equal(regressionPolicy('full'), 'full');
  assert.equal(regressionPolicy('diagnostic'), 'diagnostic');
  for (const value of ['', 'quick', false, null]) assert.throws(() => regressionPolicy(value), /run-policy/);
});

test('unexpected failure uses observed role status without an error-code whitelist', () => {
  for (const status of ['fail', 'unavailable']) for (const code of ['quote-timeout', 'redemption-supply-exceeded', 'future-error-code', undefined])
    assert.equal(unexpectedFailure({ status, code }), true);
  for (const status of ['pass', 'skipped']) assert.equal(unexpectedFailure({ status, code: 'future-error-code' }), false);
  for (const code of ['not-exercised', 'not-attempted']) for (const status of ['fail', 'unavailable'])
    assert.equal(unexpectedFailure({ status, code }), false);
  assert.equal(unexpectedFailure(undefined), false);
  const winner = { status: 'pass', alternateExecution: { status: 'fail', code: 'new-alternate-error' } };
  assert.equal(unexpectedFailure(winner), false, 'Callers identify the failing role rather than attributing an alternate to its winner.');
  assert.equal(unexpectedFailure(winner.alternateExecution), true);
});

for (const policy of ['diagnostic', 'full'] as const) test(`real browser observer ${policy} policy keeps the inventory and stops only the selected run`, async t => {
  let navigations = 0, closed = 0, checkpoints = 0;
  const inventory = activeMatrixTemplates(), snapshots: ScenarioResult[][] = [];
  t.mock.method(chromium, 'launch', async () => ({
    newPage: async () => ({ setDefaultTimeout() {}, addInitScript: async () => {},
      goto: async () => { navigations++; throw new Error('private-original-navigation-error'); },
      close: async () => { closed++; } }), close: async () => { closed++; },
  } as unknown as Browser));
  const rows = await observeBrowserQuotes('https://fixture.invalid', protocolConfigurationFixture, {} as never,
    inventory, async result => { checkpoints++; snapshots.push(structuredClone([...result])); }, undefined, policy);
  assert.equal(rows.length, 24); assert.deepEqual(rows.map(row => row.id), inventory.map(row => `ui-${row.id}`));
  assert.equal(navigations, policy === 'diagnostic' ? 1 : 24); assert.equal(checkpoints, navigations);
  assert.equal(closed, 2); assert.equal(rows[0].status, 'fail'); assert.equal(rows[0].code, 'unexpected-error');
  assert.ok(rows.every(row => row.executionAttempted === false && row.transactionDisposition === 'not-submitted'));
  if (policy === 'diagnostic') for (const row of rows.slice(1)) {
    assert.equal(row.status, 'unavailable'); assert.equal(row.code, 'not-exercised');
    assert.equal(row.providers, undefined); assert.equal(row.durationMs, undefined);
  }
  else assert.ok(rows.every(row => row.status === 'fail' && row.durationMs !== undefined));
  assert.equal(snapshots.at(-1)?.length, 24);
  assert.doesNotMatch(JSON.stringify(rows), /private-original/);
});

test('diagnostic unavailable quote result stops after the completed case even if optional checkpoint writing fails', async t => {
  let navigations = 0, writes = 0;
  const inventory = activeMatrixTemplates(); inventory[0].sizingError = 'valuation-unavailable';
  t.mock.method(chromium, 'launch', async () => ({
    newPage: async () => ({ setDefaultTimeout() {}, addInitScript: async () => {},
      goto: async () => { navigations++; }, close: async () => {} }), close: async () => {},
  } as unknown as Browser));
  const rows = await observeBrowserQuotes('https://fixture.invalid', protocolConfigurationFixture, {} as never,
    inventory, async () => { writes++; throw new Error('private-storage-error'); }, undefined, 'diagnostic');
  assert.equal(navigations, 0); assert.equal(writes, 1); assert.equal(rows[0].status, 'unavailable');
  assert.equal(rows[0].code, 'valuation-unavailable'); assert.ok(rows[0].durationMs !== undefined);
  assert.ok(rows.slice(1).every(row => row.code === 'not-exercised' && row.providers === undefined));
});

/** Run the real CLI and real browser observer, replacing only origin/browser I/O. */
function runQuotePolicy(input: { cli?: string; environment?: string; interrupted?: boolean }) {
  const output = mkdtempSync(join(tmpdir(), 'cybergold-run-policy-')), fixture = join(output, 'fixture.mjs');
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  writeFileSync(fixture, `
import { mock } from 'node:test';
import { chromium } from ${JSON.stringify(source('../../node_modules/@playwright/test/index.mjs'))};
import { writeFileSync } from 'node:fs';
import * as matrix from ${JSON.stringify(source('../../tests/trading/matrix.ts'))};
mock.module(${JSON.stringify(source('../../tests/trading/matrix.ts'))}, { namedExports: {
  ...matrix, readValuation: async () => ({id:'frozen-policy-valuation'}), buildMatrix: () => matrix.activeMatrixTemplates(),
} });
let navigations = 0;
chromium.launch = async () => ({ newPage: async () => ({ setDefaultTimeout() {}, addInitScript:async()=>{},
  goto:async()=>{navigations++; if (${Boolean(input.interrupted)} && navigations === 2) {
    process.kill(process.pid, 'SIGKILL'); await new Promise(()=>{});
  } throw new Error('private-navigation-cause');}, close:async()=>{} }),
  close:async()=>{writeFileSync(${JSON.stringify(join(output, 'actions.json'))},JSON.stringify({navigations}));} });
globalThis.fetch = async url => new URL(url).pathname === '/en'
  ? new Response('<a data-testid="deployed-commit" title="${'a'.repeat(40)}">revision</a>')
  : Response.json(new URL(url).pathname === '/api/protocol/config' ? ${JSON.stringify(protocolConfigurationFixture)} : {});
`);
  const args = ['--experimental-test-module-mocks', '--import', fixture, 'scripts/run-trade-regression.mjs',
    '--target', 'sandbox', '--mode', 'quotes', '--base-url', 'https://fixture.invalid', '--output-dir', output,
    ...(input.cli === undefined ? [] : ['--run-policy', input.cli])];
  const env = { ...process.env }; delete env.TRADE_REGRESSION_RUN_POLICY;
  if (input.environment !== undefined) env.TRADE_REGRESSION_RUN_POLICY = input.environment;
  const child = spawnSync(process.execPath, args, { cwd: new URL('../../', import.meta.url), env,
    encoding: 'utf8', timeout: 10_000 });
  return { output, child };
}

for (const [input, policy, navigations] of [
  [{}, 'full', 24], [{ environment: 'diagnostic' }, 'diagnostic', 1],
  [{ cli: 'full', environment: 'diagnostic' }, 'full', 24], [{ cli: 'diagnostic' }, 'diagnostic', 1],
] as const) test(`actual quote CLI ${JSON.stringify(input)} preserves policy, completed progress and unexercised remainder`, () => {
  const { output, child } = runQuotePolicy(input);
  try {
    assert.equal(child.status, 1, child.stderr); assert.equal(child.error, undefined);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'actions.json'), 'utf8')), { navigations });
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    const checkpoint = JSON.parse(readFileSync(join(output, 'regression-ui.json'), 'utf8'));
    assert.equal(report.runPolicy, policy); assert.equal(checkpoint.runPolicy, policy);
    assert.equal(report.scenarios.length, 24); assert.deepEqual(report.scenarios, checkpoint.scenarios);
    const completed = report.scenarios.slice(0, navigations).map((row: ScenarioResult) => row.id);
    assert.deepEqual(report.progress, { completedScenarioIds: completed });
    assert.deepEqual(checkpoint.progress, report.progress);
    assert.equal(checkpoint.finishedAt, undefined); assert.equal(checkpoint.runnerOutcome, 'unavailable');
    assert.ok(report.finishedAt);
    assert.deepEqual(report.diagnosticStop, policy === 'diagnostic' ? { scenarioId: completed[0], role: 'winner' } : undefined);
    if (policy === 'diagnostic') assert.ok(report.scenarios.slice(1).every((row: ScenarioResult) =>
      row.code === 'not-exercised' && row.executionAttempted === false && row.providers === undefined));
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('actual quote CLI rejects an invalid selected policy before browser or origin work', () => {
  const { output, child } = runQuotePolicy({ cli: 'unexpected-mode' });
  try { assert.equal(child.status, 1); assert.match(child.stderr, /run-policy must be diagnostic or full/); }
  finally { rmSync(output, { recursive: true, force: true }); }
});

test('actual running quote checkpoint distinguishes one completed failure from the unfinished run', () => {
  const { output, child } = runQuotePolicy({ interrupted: true });
  try {
    assert.equal(child.signal, 'SIGKILL', child.stderr); assert.equal(existsSync(join(output, 'report.json')), false);
    const checkpoint = JSON.parse(readFileSync(join(output, 'regression-ui.json'), 'utf8'));
    assert.equal(checkpoint.runPolicy, 'full'); assert.equal(checkpoint.scenarios.length, 1);
    assert.deepEqual(checkpoint.progress, { completedScenarioIds: [checkpoint.scenarios[0].id] });
    assert.equal(checkpoint.scenarios[0].status, 'fail'); assert.equal(checkpoint.finishedAt, undefined);
    assert.equal(checkpoint.runnerOutcome, 'unavailable'); assert.equal(checkpoint.diagnosticStop, undefined);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('actual execution CLI propagates selected policy to both wallet children and retains their exact progress', () => {
  const output = mkdtempSync(join(tmpdir(), 'cybergold-wallet-policy-')), fixture = join(output, 'fixture.mjs');
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  writeFileSync(fixture, `
import { mock } from 'node:test';
import * as matrix from ${JSON.stringify(source('../../tests/trading/matrix.ts'))};
mock.module(${JSON.stringify(source('../../tests/trading/matrix.ts'))}, { namedExports: {
  ...matrix, readValuation:async()=>({id:'frozen-wallet-policy'}), buildMatrix:()=>matrix.activeMatrixTemplates(),
} });
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { resultFor } from ${JSON.stringify(source('../../tests/trading/regression.ts'))};
const selected = [];
globalThis.fetch = async url => new URL(url).pathname === '/en' ? new Response('')
  : Response.json(new URL(url).pathname === '/api/protocol/config' ? ${JSON.stringify(protocolConfigurationFixture)} : {});
childProcess.spawn = (_executable,args,options) => {
  selected.push(options.env.TRADE_REGRESSION_RUN_POLICY);
  const child = new EventEmitter(); child.kill=()=>true;
  const setup=args[0]==='scripts/cache-metamask-wallet.mjs';
  if (!setup) {
    const scenarios=matrix.activeMatrixTemplates().map((scenario,i)=>({...resultFor(scenario,'execution'), id:'ui-'+scenario.id,
      executionAttempted:false, transactionDisposition:'not-submitted', ...(i===0?{status:'fail',code:'fresh-business-error'}:{})}));
    writeFileSync(options.env.TRADE_REGRESSION_UI_OUTPUT,JSON.stringify({suite:'sequential',scenarios,
      progress:{completedScenarioIds:[scenarios[0].id]},diagnosticStop:{scenarioId:scenarios[0].id,role:'winner'}}));
    writeFileSync(${JSON.stringify(join(output, 'children.json'))},JSON.stringify(selected));
  }
  process.nextTick(()=>child.emit('exit',setup?0:1,null)); return child;
}; syncBuiltinESMExports();
`);
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', fixture,
    'scripts/run-trade-regression.mjs', '--target', 'sandbox', '--mode', 'sandbox-execution', '--run-policy', 'diagnostic',
    '--base-url', 'https://fixture.invalid', '--output-dir', output], { cwd: new URL('../../', import.meta.url),
    env: { ...process.env, TRADE_REGRESSION_RUN_POLICY: 'full' }, encoding: 'utf8', timeout: 10_000 });
  try {
    assert.equal(child.status, 1, child.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'children.json'), 'utf8')), ['diagnostic', 'diagnostic']);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(report.runPolicy, 'diagnostic'); assert.equal(report.suite, 'sequential'); assert.equal(report.scenarios.length, 24);
    assert.deepEqual(report.progress, { completedScenarioIds: [report.scenarios[0].id] });
    assert.deepEqual(report.diagnosticStop, { scenarioId: report.scenarios[0].id, role: 'winner' });
    assert.ok(report.scenarios.slice(1).every((row: ScenarioResult) => row.code === 'not-exercised' && row.providers === undefined));
  } finally { rmSync(output, { recursive: true, force: true }); }
});
