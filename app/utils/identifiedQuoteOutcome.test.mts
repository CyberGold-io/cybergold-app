import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuotePreviewError } from './quoteErrors.ts';
import { failureResult, RegressionAssertionError, resultFor } from '../../tests/trading/regression.ts';
import { activeMatrixTemplates } from '../../tests/trading/matrix.ts';
import { executionCoverage } from '../../tests/trading/providerEvidence.ts';
import { regressionOutcome, unexpectedFailure } from '../../tests/trading/runPolicy.ts';

const original = { ...resultFor({ ...activeMatrixTemplates().find(row => row.id === 'core-redeem-basket-exact-in-large')!,
  amountRaw: '77599013858487449084', displayAmount: '77.599013858487449084' }, 'browser'),
  executionAttempted: false, transactionDisposition: 'not-submitted' as const };

for (const code of ['insufficient-protocol-supply', 'issuance-cap-exceeded', 'redemption-supply-exceeded',
  'insufficient-reserve-balance', 'insufficient-recovery-shares', 'redemption-capacity-exceeded',
  'quote-insufficient-liquidity'] as const) test('specific quote rejection remains distinct: ' + code, () => {
  const result = failureResult(original, new QuotePreviewError(code, code));
  assert.equal(result.status, 'rejected'); assert.equal(result.code, code);
  assert.equal(result.nominalUsd, '10000');
  assert.equal(result.amountRaw, '77599013858487449084');
  assert.equal(result.constraint, undefined, 'Optional evidence is not an admission requirement.');
  assert.deepEqual(result.refs, {});
  assert.equal(result.bounds, undefined); assert.equal(result.receipt, undefined);
  assert.equal(result.transactionHash, undefined); assert.equal(result.executionAttempted, false);
  assert.equal(result.transactionDisposition, 'not-submitted'); assert.equal(unexpectedFailure(result), false);
});

test('identified rejection preserves supplied constraints and references', () => {
  const constraint = { kind: 'redemption-supply', quantity: 'gross-cygld-input', requestedRaw: original.amountRaw };
  const refs = { requestId: '48c7e9e4-faa8-47e6-89c3-41422b251266' };
  const result = failureResult(original, new QuotePreviewError('redemption-supply-exceeded', 'capacity', refs, undefined, constraint));
  assert.equal(result.status, 'rejected'); assert.deepEqual(result.constraint, constraint);
  assert.deepEqual(result.refs, refs);
});

test('technical and opaque quote errors stay failed even with a recognized code', () => {
  for (const code of ['quote-timeout', 'quote-no-route', 'quote-contract-reverted', 'quote-stream-interrupted',
    'quote-unavailable', 'quote-service-unavailable', 'quote-invalid-input', 'quote-request-limit',
    'rpc-rate-limit', 'rpc-timeout', 'rpc-unavailable', 'rpc-access-denied'] as const) {
    const result = failureResult(original, new QuotePreviewError(code, code));
    assert.equal(result.status, 'fail', code); assert.equal(unexpectedFailure(result), true);
  }
  const assertion = failureResult(original, new RegressionAssertionError('redemption-supply-exceeded'));
  assert.equal(assertion.status, 'fail', 'An assertion is not a protocol refusal with a matching string.');
  assert.equal(failureResult(original, Object.assign(new Error('private'), { code: 'redemption-supply-exceeded' })).status, 'fail');
});

test('mixed and all-rejected runs complete without claiming every quote passed', () => {
  const rejection = failureResult(original, new QuotePreviewError('redemption-supply-exceeded', 'capacity'));
  const mixed = [{ ...original, status: 'pass' as const }, rejection];
  assert.equal(regressionOutcome(mixed), 'completed-with-rejections');
  assert.equal(regressionOutcome([rejection]), 'completed-with-rejections');
  assert.equal(regressionOutcome([{ ...original, status: 'pass' }]), 'pass');
  assert.equal(regressionOutcome(mixed, 'fail'), 'fail');
  assert.equal(regressionOutcome([...mixed, { status: 'fail' }]), 'fail');
  assert.equal(regressionOutcome([{ status: 'unavailable', code: 'not-exercised' }]), 'fail');
  const coverage = executionCoverage(mixed);
  assert.equal(coverage.ui.pass, 1); assert.equal(coverage.ui.rejected, 1);
  assert.equal(coverage.ui.fail, 0); assert.equal(coverage.uiAttempted, 0);
  assert.equal(regressionOutcome([{ status: 'pass', alternateExecution: rejection }]), 'completed-with-rejections');
});

for (const codes of [
  ['redemption-supply-exceeded', 'quote-insufficient-liquidity'],
  ['redemption-supply-exceeded', 'quote-timeout', 'issuance-cap-exceeded'],
]) test('actual quote CLI continues identified rejections and retains failure stopping: ' + codes.join(','), () => {
  const output = mkdtempSync(join(tmpdir(), 'cybergold-identified-outcomes-'));
  try {
    const fixture = fileURLToPath(new URL('../../tests/fixtures/identified-quote-runner.mjs', import.meta.url));
    const actionsPath = join(output, 'actions.json');
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', fixture,
      'scripts/run-trade-regression.mjs', '--target', 'sandbox', '--mode', 'quotes',
      '--base-url', 'https://fixture.invalid', '--output-dir', output, '--run-policy', 'diagnostic'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, REJECTION_FIXTURE_CODES: JSON.stringify(codes), REJECTION_FIXTURE_ACTIONS: actionsPath },
    });
    assert.equal(child.error, undefined, child.stderr);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    const actions = JSON.parse(readFileSync(actionsPath, 'utf8'));
    const terminal = codes.includes('quote-timeout');
    assert.equal(child.status, terminal ? 1 : 0, child.stderr);
    assert.equal(report.outcome, terminal ? 'fail' : 'completed-with-rejections');
    assert.equal(actions.navigations, 2);
    assert.ok(actions.requests.every((row: { inputs: { amount: string }[] }) =>
      row.inputs[0].amount === '77599013858487449084'));
    assert.equal(report.scenarios[0].status, 'rejected');
    assert.equal(report.scenarios[1].status, terminal ? 'fail' : 'rejected');
    assert.ok(report.scenarios.every((row: { nominalUsd: string; amountRaw: string }) =>
      row.nominalUsd === '10000' && row.amountRaw === '77599013858487449084'));
    assert.equal(report.scenarios.length, codes.length);
    if (terminal) assert.equal(report.scenarios[2].code, 'not-exercised');
    else assert.equal(report.diagnosticStop, undefined);
    assert.ok(report.scenarios.every((row: { bounds?: unknown; receipt?: unknown; transactionDisposition: string }) =>
      !row.bounds && !row.receipt && row.transactionDisposition === 'not-submitted'));
  } finally { rmSync(output, { recursive: true, force: true }); }
});
