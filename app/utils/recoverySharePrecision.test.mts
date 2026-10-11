import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRecoverySharePrecision, formatRecoveryShareAmount, recoverySharePrecisionQuery } from './recoverySharePrecision.ts';

const asset = `0x${'1'.repeat(40)}` as const;
const core = `0x${'2'.repeat(40)}` as const;

test('permanent share precision formats exact raw amounts independently of basket/token decimals', () => {
  assert.equal(formatRecoveryShareAmount(2_500_001n, 6), '2.500001');
  assert.equal(formatRecoveryShareAmount(2_500_001n, 0), '2500001');
  assert.equal(formatRecoveryShareAmount(10n ** 255n, 255), '1');
  assert.equal(formatRecoveryShareAmount(2n ** 200n, 18), '1606938044258990275541962092341162602522202.993782792835301376');
  assert.equal(formatRecoveryShareAmount(0n, 6), '0');
});

test('missing precision displays raw shares without inventing zero or token precision', () => {
  assert.equal(formatRecoveryShareAmount(2_500_001n), '2500001 raw');
  assert.equal(formatRecoveryShareAmount(0n), '0 raw');
});

test('fixed precision request preserves asset identity and cancellation without a browser bearer', async () => {
  const signal = new AbortController().signal;
  const snapshot = { asset, core, shareDecimals: 6 };
  assert.deepEqual(await fetchRecoverySharePrecision(asset, signal, (async (url, init) => {
    assert.equal(url, `/api/protocol/recovery-share-precision?asset=${asset}`);
    assert.equal(init?.signal, signal); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json(snapshot);
  }) as typeof fetch), snapshot);
});

test('unavailable precision fails without a browser RPC retry or a successful zero result', async () => {
  let calls = 0;
  await assert.rejects(fetchRecoverySharePrecision(asset, undefined, (async () => {
    calls += 1; return new Response(null, { status: 503 });
  }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 1);
});

test('query reuse remains asset/chain/Core/fork-specific with the existing precision freshness', () => {
  const query = recoverySharePrecisionQuery(asset, 31338, core, 'generation-one');
  assert.equal(query.staleTime, 15_000);
  assert.notDeepEqual(query.queryKey, recoverySharePrecisionQuery(`0x${'3'.repeat(40)}`, 31338, core, 'generation-one').queryKey);
  assert.notDeepEqual(query.queryKey, recoverySharePrecisionQuery(asset, 1, core, null).queryKey);
  assert.notDeepEqual(query.queryKey, recoverySharePrecisionQuery(asset, 31338, `0x${'4'.repeat(40)}`, 'generation-one').queryKey);
  assert.notDeepEqual(query.queryKey, recoverySharePrecisionQuery(asset, 31338, core, 'generation-two').queryKey);
});
