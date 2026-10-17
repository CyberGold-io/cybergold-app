import assert from 'node:assert/strict';
import test from 'node:test';
import { transactionDisposition } from '../../tests/trading/providerEvidence.ts';
import type { ScenarioResult } from '../../tests/trading/regression.ts';

test('receipt-confirmed settlement survives a separate UI completion failure', () => {
  const result = { status: 'fail', executionAttempted: true, executionStage: 'ui-confirmation',
    code: 'ui-completion-not-observed', transactionHash: `0x${'a'.repeat(64)}`, transactionDisposition: 'confirmed' } as ScenarioResult;
  assert.equal(transactionDisposition(result), 'confirmed');
  assert.equal(result.status, 'fail');
  delete result.transactionDisposition;
  assert.equal(transactionDisposition(result), 'unknown');
  result.transactionDisposition = 'confirmed'; delete result.transactionHash;
  assert.equal(transactionDisposition(result), 'unknown');
});
