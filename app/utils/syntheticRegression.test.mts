import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import SyntheticReporter from '../../tests/trading/syntheticReporter.ts';
import { copySyntheticSource, finishSyntheticReport, recordSyntheticCase, syntheticCase, syntheticConfig,
  syntheticEnvironment, syntheticFiles, syntheticReport } from '../../tests/trading/syntheticRegression.ts';

test('synthetic reports describe actual UI cases without claiming native settlement or the economic matrix', () => {
  const report = syntheticReport('sequential', 'run', '2026-11-07T00:00:00Z');
  const results = ['passed', 'failed', 'skipped', 'interrupted', 'timedOut'];
  for (const [index, status] of results.entries()) {
    recordSyntheticCase(report, syntheticCase('/private/local/market-swaps.spec.ts', `case ${index}`, status, 10 + index));
  }
  assert.deepEqual(report.counts, { total: 5, passed: 1, failed: 2, skipped: 1, interrupted: 1 });
  assert.equal(new Set(report.progress.completedScenarioIds).size, 5);
  assert.equal(report.evidenceKind, 'mocked-ui');
  assert.equal(report.transactionEvidence, 'synthetic-hashes-mocked-receipts');
  assert.equal(report.mode, 'synthetic');
  assert.equal(report.runnerOutcome, 'unavailable');
  assert.ok(report.scenarios.every(row => row.family === 'runner' && row.inputMode === 'unknown' && row.layer === 'browser'));
  assert.equal(report.scenarios[0].testFile, 'tests/e2e/market-swaps.spec.ts');
  assert.deepEqual(Object.keys(report.scenarios[0]).sort(), ['code', 'durationMs', 'evidenceKind', 'family', 'id',
    'inputMode', 'layer', 'name', 'status', 'testFile']);
  assert.equal('matrix' in report, false);
  finishSyntheticReport(report, 'failed');
  assert.equal(report.runnerOutcome, 'fail');
  assert.equal(report.runnerCode, 'mocked-ui-failed');
});

test('UI case identities survive temporary paths and keep distinct file/title cases', () => {
  const one = syntheticCase('/one/market-swaps.spec.ts', 'the same actual case', 'passed', 1);
  const two = syntheticCase('/two/market-swaps.spec.ts', 'the same actual case', 'failed', 2);
  assert.equal(one.id, two.id);
  assert.notEqual(one.id, syntheticCase('/one/wallet-batch.spec.ts', one.name, 'passed', 1).id);
  const report = syntheticReport('independent', 'run', 'start');
  recordSyntheticCase(report, one); recordSyntheticCase(report, two);
  assert.equal(report.scenarios.length, 1);
  assert.deepEqual(report.counts, { total: 1, passed: 0, failed: 1, skipped: 0, interrupted: 0 });
});

test('the reporter checkpoints only completed cases and excludes raw failure/provider details', async () => {
  const output = await mkdtemp(join(tmpdir(), 'synthetic-reporter-'));
  try {
    const report = syntheticReport('independent', 'run', 'start');
    report.runnerDiagnostics.stage = 'synthetic-ui-tests';
    const reporter = new SyntheticReporter({ outputDir: output, report });
    const fixtureCase = { titlePath: () => ['', 'chromium', 'a submitted swap'],
      location: { file: '/tmp/source/swap-confirmation-feedback.spec.ts' } } as TestCase;
    const result = { status: 'failed', duration: 31, errors: [{ message: 'private-seed signed-rawtx provider-url' }],
      attachments: [{ name: 'private-wallet', body: Buffer.from('private-wallet') }] } as TestResult;
    reporter.onTestEnd(fixtureCase, result);
    await reporter.onEnd({ status: 'failed' } as FullResult);
    const text = await readFile(join(output, 'report.json'), 'utf8'), stored = JSON.parse(text);
    assert.equal(stored.scenarios.length, 1);
    assert.equal(stored.scenarios[0].durationMs, 31);
    assert.equal(stored.scenarios[0].code, 'mocked-ui-failed');
    assert.deepEqual(stored.progress.completedScenarioIds, [stored.scenarios[0].id]);
    assert.equal(stored.runnerOutcome, 'fail');
    assert.equal(/private-seed|signed-rawtx|provider-url|private-wallet/.test(text), false);
    assert.deepEqual(await readdir(output), ['report.json']);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('the synthetic browser selection reuses four ordinary specs and local Next without native setup', () => {
  const report = syntheticReport('sequential', 'run', 'start');
  const config = syntheticConfig('/tmp/owned frontend', '/tmp/results', 3456, report);
  assert.deepEqual(config.testMatch, ['market-swaps.spec.ts', 'execution-tolerance.spec.ts',
    'swap-confirmation-feedback.spec.ts', 'wallet-batch.spec.ts']);
  assert.deepEqual(config.testMatch, [...syntheticFiles]);
  assert.equal(config.testDir, '/tmp/owned frontend/tests/e2e');
  assert.equal(config.workers, 1); assert.equal(config.retries, 0); assert.equal(config.timeout, 120_000);
  assert.equal(config.use.baseURL, 'http://127.0.0.1:3456');
  assert.equal(config.webServer.url, config.use.baseURL + '/en');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.ok(config.webServer.command.includes("'/tmp/owned frontend/node_modules/next/dist/bin/next' start"));
  assert.deepEqual(config.projects, [{ name: 'chromium', use: { browserName: 'chromium' } }]);
  assert.deepEqual(config.reporter[0], ['list']);
  assert.equal(/metamask|qualify-fixed|fork-execution|funding|wallet-setup/.test(JSON.stringify(config)), false);
});

test('the frontend environment uses the checked-in fixture without inheriting private runtime settings', () => {
  const environment = syntheticEnvironment({ PATH: '/node/bin', HOME: '/private/home',
    CYBERGOLD_BACKEND_URL: 'https://private-backend', CYBERGOLD_BACKEND_BEARER_TOKEN: 'private-token',
    SYNPRESS_WALLET_SEED_PHRASE: 'private-seed', NEXT_PUBLIC_WALLET_RPC_URL: 'https://private-rpc',
    PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright', PLAYWRIGHT_BASE_URL: 'https://public-app' },
  { NEXT_PUBLIC_CHAIN_ID: '31337', NEXT_PUBLIC_CHAIN_NAME: 'Ethereum Anvil' }, '/tmp/owned');
  assert.equal(environment.PATH, '/node/bin');
  assert.equal(environment.PLAYWRIGHT_BROWSERS_PATH, '/opt/playwright');
  assert.equal(environment.HOME, '/tmp/owned');
  assert.equal(environment.TMPDIR, '/tmp/owned');
  assert.equal(environment.NEXT_PUBLIC_CHAIN_ID, '31337');
  assert.equal(/private-|public-app/.test(JSON.stringify(environment)), false);
});

test('Mainnet synthetic execution selects chain one while retaining mocked settlement and isolated environment', () => {
  const report = syntheticReport('sequential', 'run', 'start', 'mainnet');
  assert.equal(report.target, 'mainnet'); assert.equal(report.chainId, 1);
  assert.equal(report.testContext, 'mocked-mainnet'); assert.equal(report.mode, 'synthetic');
  assert.equal(report.transactionEvidence, 'synthetic-hashes-mocked-receipts');
  const environment = syntheticEnvironment({ PATH: '/node/bin', NEXT_PUBLIC_CHAIN_ID: '999',
    CYBERGOLD_BACKEND_URL: 'https://private-backend', SYNPRESS_WALLET_SEED_PHRASE: 'private-seed' },
    { NEXT_PUBLIC_CHAIN_ID: '31337', NEXT_PUBLIC_CHAIN_NAME: 'Ethereum Anvil', NEXT_PUBLIC_FORK_FAUCET_ENABLED: '1' }, '/tmp/owned', 'mainnet');
  assert.equal(environment.NEXT_PUBLIC_CHAIN_ID, '1'); assert.equal(environment.NEXT_PUBLIC_CHAIN_NAME, 'Ethereum');
  assert.equal(environment.NEXT_PUBLIC_FORK_FAUCET_ENABLED, '0');
  assert.doesNotMatch(JSON.stringify(environment), /private-backend|private-seed|999/);
  assert.deepEqual(syntheticConfig('/tmp/owned', '/tmp/reports', 3456, report).testMatch, [...syntheticFiles]);
});

test('the writable frontend copy excludes local environments, wallet caches and repository state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-source-'));
  try {
    const source = join(root, 'source'), work = join(root, 'work');
    for (const directory of ['app', 'components', 'i18n', 'lib', 'messages', 'public', 'tests/e2e',
      'tests/fixtures', 'tests/trading', 'scripts', 'node_modules', 'wallet-setup', '.cache-synpress', '.git']) {
      await mkdir(join(source, directory), { recursive: true });
      await writeFile(join(source, directory, 'fixture.txt'), directory);
    }
    for (const file of ['next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'package.json',
      'instrumentation.ts', 'proxy.ts', '.env.local']) await writeFile(join(source, file), file);
    await mkdir(work);
    await copySyntheticSource(source, work);
    const names = await readdir(work);
    assert.equal(names.includes('.env.local'), false);
    assert.equal(await readFile(join(work, 'wallet-setup/fixture.txt'), 'utf8'), 'wallet-setup');
    assert.equal(names.includes('.cache-synpress'), false);
    assert.equal(names.includes('.git'), false);
    assert.equal(await readFile(join(work, 'tests/e2e/fixture.txt'), 'utf8'), 'tests/e2e');
    assert.equal(await readFile(join(work, 'node_modules/fixture.txt'), 'utf8'), 'node_modules');
  } finally { await rm(root, { recursive: true, force: true }); }
});
