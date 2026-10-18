import assert from 'node:assert/strict';
import test from 'node:test';
import { observedBasketProviderEvidence } from '../../tests/trading/providerEvidence.ts';
import type { MatrixScenario } from '../../tests/trading/matrix.ts';
import type { QuoteObservation } from '../../tests/trading/quoteObservation.ts';
import { tokenAddresses } from '../../tests/fixtures/protocol-configuration.ts';
import { protocolConfigurationFixture } from '../../tests/fixtures/protocol-configuration.ts';
import { chromium, expect, type Browser } from '@playwright/test';
import { observeBrowserQuotes } from '../../tests/trading/browserQuotes.ts';

const scenario = { id: 'core-issue-basket-exact-in-medium', family: 'issue-basket', requestedStrategy: 'core',
  asset: 'BASKET', side: 'buy', inputMode: 'exact-in', size: 'medium', nominalUsd: '100', displayAmount: '0.01',
  amountRaw: '10000000000000000', valuationId: 'a'.repeat(64), basketAmounts: ['10000000000000000', '10000'],
  basketAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT] } satisfies MatrixScenario;
const complete = (): QuoteObservation => ({ path: '/api/quotes/basket-preview', status: 200,
  request: { mode: 'issue-exact-in', maximumAmountsIn: scenario.basketAmounts },
  terminal: { type: 'complete', value: { mode: 'issue-exact-in', context: { chainId: 31337, blockNumber: '100' }, result: { netCygldOut: '2000000000000000000' } } } });

test('qualified basket quote survives a failure before Swap selection is captured', () => {
  const result = observedBasketProviderEvidence([complete()], scenario);
  assert.equal(result.core.availability, 'qualified');
  assert.equal(result.core.searchOutcome, 'complete');
  assert.equal(result.core.context?.blockNumber, '100');
  assert.match(result.core.planDigest!, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.market, { availability: 'unsupported', searchOutcome: 'not-run' });
});

test('another mode or amount cannot supply basket evidence for this scenario', () => {
  const wrongMode = complete(); wrongMode.request = { mode: 'redeem-exact-out', minimumOutputs: scenario.basketAmounts.map((amount, i) => ({ kind: 0, token: scenario.basketAssets[i], id: '0', minimumAmount: amount })) };
  const wrongAmount = complete(); wrongAmount.request = { mode: 'issue-exact-in', maximumAmountsIn: ['1', '2'] };
  assert.equal(observedBasketProviderEvidence([wrongMode, wrongAmount], scenario).core.availability, 'not-run');
});

test('basket product limits retain their error code instead of becoming an unexplained error', () => {
  const row = complete(); row.status = 422; row.terminal = { type: 'error', code: 'issuance-cap-exceeded' };
  assert.deepEqual(observedBasketProviderEvidence([row], scenario).core, {
    availability: 'unavailable', searchOutcome: 'error', code: 'issuance-cap-exceeded', refs: {} });
  row.terminal = { type: 'error', code: 'quote-timeout' };
  assert.equal(observedBasketProviderEvidence([row], scenario).core.searchOutcome, 'timeout');
});

test('unfinished and cancelled basket searches stay distinct from completed quotation failures', () => {
  const row = complete(); delete row.terminal;
  assert.deepEqual(observedBasketProviderEvidence([row], scenario).core, { availability: 'pending', searchOutcome: 'running', refs: {} });
  row.interrupted = true;
  assert.deepEqual(observedBasketProviderEvidence([row], scenario).core, { availability: 'unavailable', searchOutcome: 'cancelled', refs: {} });
});

for (const inputMode of ['exact-in', 'exact-out'] as const) test(`quote-only basket ${inputMode} keeps provider evidence for a supply-limit failure`, async t => {
  const sale = { ...scenario, id: `core-redeem-basket-${inputMode}-large`, side: 'sell' as const,
    family: 'redeem-basket' as const, inputMode, size: 'large' as const, nominalUsd: '10000' };
  const request = inputMode === 'exact-in' ? { mode: 'redeem-exact-in', grossCygldIn: sale.amountRaw }
    : { mode: 'redeem-exact-out', minimumOutputs: sale.basketAmounts.map((amount, i) => ({
      kind: 0, token: sale.basketAssets[i], id: '0', minimumAmount: amount })) };
  const requestId = 'e9eb96b2-8ecf-429d-9e08-244f43257e8e';
  const observation: QuoteObservation = { path: '/api/quotes/basket-preview', request, status: 422, requestId,
    terminal: { type: 'error', code: 'insufficient-protocol-supply', requestId, error: 'private-provider-detail' } };
  let filled = false;
  const locator = () => {
    const value = { _apiName: 'Locator', _expect: async () => ({ matches: true }),
      filter: () => value, first: () => value, last: () => value, or: () => value,
      getByRole: () => value, locator: () => value, waitFor: async () => {},
      isVisible: async () => false, click: async () => {}, fill: async () => { filled = true; } };
    return value;
  };
  const page = { setDefaultTimeout: () => {}, addInitScript: async () => {}, goto: async () => {},
    getByRole: locator, locator, evaluate: async () => filled ? [observation] : [], close: async () => {} };
  t.mock.method(chromium, 'launch', async () => ({ newPage: async () => page, close: async () => {} } as unknown as Browser));
  t.mock.method(expect, 'poll', ((read: () => Promise<unknown>) => ({
    toBe: async (expected: unknown) => assert.equal(await read(), expected),
  })) as never);
  const [result] = await observeBrowserQuotes('https://fixture.invalid', protocolConfigurationFixture, {
    basket: { assets: { status: 'success', value: sale.basketAssets }, targetsPpm: { status: 'success', value: ['500000', '500000'] } },
  } as never, [sale]);
  assert.equal(result.status, 'fail'); assert.equal(result.code, 'insufficient-protocol-supply');
  assert.deepEqual(result.providers?.core, { availability: 'unavailable', searchOutcome: 'error',
    code: 'insufficient-protocol-supply', refs: { requestId } });
  assert.deepEqual(result.providers?.market, { availability: 'unsupported', searchOutcome: 'not-run' });
  assert.doesNotMatch(JSON.stringify(result), /private-provider-detail/);
});
