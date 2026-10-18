import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroAddress } from 'viem';
import { measureQuality, tradeQualityTerms, basketQualityTerms, receiptQualityTerms, enrichResultQuality, type QualityTerms } from '../../tests/trading/quoteQuality.ts';
import { protocolConfigurationFixture as config, tokenAddresses as tokens } from '../../tests/fixtures/protocol-configuration.ts';
import { buildMatrix, type ValuationSnapshot } from '../../tests/trading/matrix.ts';
import { resultFor } from '../../tests/trading/regression.ts';
import { providerSummaries, captureSelection, notAttemptedAlternate } from '../../tests/trading/providerEvidence.ts';
import type { ScenarioResult } from '../../tests/trading/regression.ts';
import type { TradeQuote } from './tradeQuote.ts';
import type { BasketPreview, BasketPreviewRequest } from './basketPreview.ts';

const p = (n: bigint, decimals: number) => ({ numerator: String(n), denominator: String(10n ** BigInt(decimals)) });
const valuation: ValuationSnapshot = { id: 'a'.repeat(64), source: 'usdc-anchored-pool-observations', observedAt: '2026-10-18T05:00:00Z',
  assumption: 'one-usdc-is-one-usd', rounding: 'floor-raw-units', prices: {
    [tokens.USDC.toLowerCase()]: p(1n, 6), [tokens.CYGLD.toLowerCase()]: p(100n, 18),
    [tokens.WETH.toLowerCase()]: p(2000n, 18), [tokens.PAXG.toLowerCase()]: p(4000n, 18), [tokens.XAUT.toLowerCase()]: p(4000n, 6),
  }, basketAssets: [tokens.PAXG, tokens.XAUT], basketWeights: ['500000', '500000'], observations: [] };
const row = (asset: string, raw: bigint | string) => ({ asset, amount: String(raw) });
const terms: QualityTerms = { inputSpent: [row(tokens.USDC, 100_000_000n)], netOutput: [row(tokens.CYGLD, 950_000_000_000_000_000n)],
  requestedInput: [row(tokens.USDC, 200_000_000n)], inputMaximum: [row(tokens.USDC, 201_000_000n)], refundCoverage: 'observed-helper-refunds' };
const gas = { nativeAmount: '5000000000000000', basis: 'actual-observed-receipts' as const, scope: 'trade-and-observed-approvals' as const };

test('quality implements both requested formulas with exact decimal values and gas priced from the same snapshot', () => {
  const q = measureQuality(terms, valuation, config, 'settled', gas);
  assert.equal(q.inputSpentUsd, '100.000000000000'); assert.equal(q.netOutputUsd, '95.000000000000');
  assert.equal(q.userGasUsd, '10.000000000000'); assert.equal(q.economicPct, '95.000000000000'); assert.equal(q.netPct, '86.363636363636');
  assert.equal(q.inputUsePct, '50.000000000000'); assert.equal(q.inputUseState, 'partial');
  assert.equal(q.requestedInputUsd, '200.000000000000'); assert.equal(q.inputMaximumUsd, '201.000000000000');
  assert.equal(q.valuationId, valuation.id); assert.equal(q.valuationObservedAt, valuation.observedAt);
  assert.equal(q.precisionDecimals, 12); assert.equal(q.rounding, 'floor');
});

test('gas is explicitly missing, while economic value remains available; a measured zero stays distinct', () => {
  const absent = measureQuality(terms, valuation, config, 'quoted');
  assert.equal(absent.economicState, 'available'); assert.equal(absent.netState, 'unavailable'); assert.equal(absent.netReason, 'missing-gas');
  assert.equal(absent.userGasUsd, undefined); assert.equal(absent.netPct, undefined);
  const actualZero = measureQuality(terms, valuation, config, 'settled', { ...gas, nativeAmount: '0' });
  assert.equal(actualZero.netPct, actualZero.economicPct); assert.equal(actualZero.gasBasis, 'actual-observed-receipts');
  const estimated = measureQuality(terms, valuation, config, 'quoted', { ...gas, basis: 'estimate', scope: 'trade-only' });
  assert.equal(estimated.netPct, '86.363636363636'); assert.equal(estimated.gasBasis, 'estimate'); assert.equal(estimated.gasScope, 'trade-only');
});

test('a native asset uses only captured WETH valuation; missing prices are never zero or a current fallback', () => {
  const native: QualityTerms = { ...terms, inputSpent: [row(zeroAddress, 50_000_000_000_000_000n)] };
  assert.equal(measureQuality(native, valuation, config, 'quoted').economicPct, '95.000000000000');
  const missing = structuredClone(valuation); delete missing.prices[tokens.WETH.toLowerCase()];
  const price = measureQuality(terms, missing, config, 'settled', gas);
  assert.equal(price.economicPct, '95.000000000000'); assert.equal(price.netReason, 'missing-gas-price');
  assert.equal(price.netPct, undefined); assert.deepEqual(price.missingAssets, [zeroAddress]);
  assert.equal(measureQuality(native, missing, config, 'quoted').economicReason, 'missing-price');
});

test('partial quotes do not invent spend from the approval maximum or label refunds as new output', () => {
  const candidate = { strategy: 'core', side: 'buy', mode: 'exact-in', tokenIn: tokens.USDC, tokenOut: tokens.CYGLD,
    quotedInput: '10000000000', quotedOutput: '77680933308000', inputMaximum: '10000000000',
    providerRequest: { amount: '10000000000', native: false }, providerQuote: { expectedInputAmount: '33377594' } } as TradeQuote;
  const expected = tradeQualityTerms(candidate), q = measureQuality(expected, valuation, config, 'quoted');
  assert.equal(q.inputSpentUsd, '33.377594000000'); assert.equal(q.requestedInputUsd, '10000.000000000000');
  assert.equal(q.inputUsePct, '0.333775940000'); assert.equal(q.inputUseState, 'partial');
  assert.equal(q.refundCoverage, 'not-disclosed'); assert.equal(q.valueBasis, 'disclosed-quoted-terms');
  delete (candidate.providerQuote as { expectedInputAmount?: string }).expectedInputAmount;
  const absent = measureQuality(tradeQualityTerms(candidate), valuation, config, 'quoted');
  assert.equal(absent.economicReason, 'input-spend-not-observed'); assert.equal(absent.inputSpentUsd, undefined);
});

test('market fees, input dust and disclosed output refund are each counted once', () => {
  const candidate = { strategy: 'market', side: 'sell', mode: 'exact-in', tokenIn: tokens.CYGLD, tokenOut: tokens.USDC,
    quotedInput: '1000000000000000000', quotedOutput: '98000000', inputMaximum: '1000000000000000000',
    providerRequest: { amount: '1000000000000000000' }, providerQuote: { refundDust: '10000000000000000', outputRefundEstimate: '1000000' } } as TradeQuote;
  const q = measureQuality(tradeQualityTerms(candidate), valuation, config, 'quoted');
  assert.equal(q.inputSpentUsd, '99.000000000000'); assert.equal(q.netOutputUsd, '99.000000000000'); assert.equal(q.economicPct, '100.000000000000');
});

test('all-asset receipt refunds include collateral and exclude already-netted input and included output refunds', () => {
  const observed = receiptQualityTerms(terms,
    [row(tokens.USDC, 100_000_000n), row(tokens.CYGLD, 5_000_000_000_000_000n), row(tokens.CYGLD, 5_000_000_000_000_000n), row(tokens.PAXG, 1_000_000_000_000_000n)],
    [row(tokens.CYGLD, 10_000_000_000_000_000n)]);
  const q = measureQuality(observed, valuation, config, 'settled');
  assert.equal(q.inputSpentUsd, '100.000000000000'); assert.equal(q.netOutputUsd, '99.000000000000'); assert.equal(q.economicPct, '99.000000000000');
  const missing = measureQuality(receiptQualityTerms(terms, undefined), valuation, config, 'settled');
  assert.equal(missing.economicReason, 'refund-evidence-unavailable'); assert.equal(missing.economicPct, undefined);
  assert.equal(missing.refundCoverage, 'not-observed');
});

test('unpriced collateral or recovery outputs make completeness explicit rather than discarding value', () => {
  const unpriced = receiptQualityTerms(terms, [row('0x0000000000000000000000000000000000000099', 1n)]);
  const q = measureQuality(unpriced, valuation, config, 'settled');
  assert.equal(q.economicState, 'unavailable'); assert.equal(q.economicReason, 'missing-price'); assert.equal(q.priceCoverage, 'incomplete');
  assert.equal(q.netOutputUsd, undefined);
  const recovery = { ...terms, netOutput: [...terms.netOutput!, { ...row(tokens.PAXG, 1n), kind: 1, id: '12' }] };
  assert.equal(measureQuality(recovery, valuation, config, 'settled').economicReason, 'missing-price');
});

test('basket metrics use all ordered mixed-decimal assets, exact amounts and explicit output modes', () => {
  const request: BasketPreviewRequest = { mode: 'issue-exact-out', netCygldOut: '1000000000000000000' };
  const preview = { mode: 'issue-exact-out', result: { orderedCoreAssets: [tokens.PAXG, tokens.XAUT], amountsInExact: ['12500000000000000', '12500'] } } as BasketPreview;
  const q = measureQuality(basketQualityTerms(preview, request, tokens.CYGLD), valuation, config, 'quoted');
  assert.equal(q.inputSpentUsd, '100.000000000000'); assert.equal(q.netOutputUsd, '100.000000000000'); assert.equal(q.economicPct, '100.000000000000');
  assert.equal(q.inputUseState, 'not-applicable');
  const redeem = { mode: 'redeem-exact-out', result: { grossCygldIn: '1000000000000000000', projectedCoreOutputs: [
    { kind: 0, token: tokens.XAUT, id: '0', amount: '12500' }, { kind: 0, token: tokens.PAXG, id: '0', amount: '12500000000000000' }] } } as BasketPreview;
  assert.equal(measureQuality(basketQualityTerms(redeem, { mode: 'redeem-exact-out', minimumOutputs: [] }, tokens.CYGLD), valuation, config, 'quoted').economicPct, '100.000000000000');
});

test('large raw amounts keep fractional prices and ratios without Number conversion', () => {
  const enormous = 2n ** 240n;
  const prices = { ...valuation, prices: { ...valuation.prices, [tokens.USDC.toLowerCase()]: { numerator: '1', denominator: '3' } } };
  const q = measureQuality({ inputSpent: [row(tokens.USDC, enormous)], netOutput: [row(tokens.USDC, enormous - 1n)], refundCoverage: 'not-disclosed' }, prices, config, 'quoted');
  assert.equal(q.economicPct, '99.999999999999');
  assert.equal(q.inputSpentUsd, `${enormous / 3n}.${String((enormous % 3n) * 10n ** 12n / 3n).padStart(12, '0')}`);
  assert.equal(measureQuality({ ...terms, inputSpent: [row(tokens.USDC, 0n)] }, valuation, config, 'quoted').economicReason, 'zero-input-value');
  assert.equal(measureQuality(terms, undefined, config, 'quoted').economicReason, 'valuation-unavailable');
});

test('winner/provider/checkpoint enrichment shares one calculation and leaves status, selection and executable terms unchanged', () => {
  const candidate = { strategy: 'core', side: 'buy', mode: 'exact-in', tokenIn: tokens.USDC, tokenOut: tokens.CYGLD,
    quotedInput: '100000000', quotedOutput: '950000000000000000', inputMaximum: '101000000', outputMinimum: '940000000000000000',
    providerRequest: { amount: '200000000', native: false }, providerQuote: { expectedInputAmount: '100000000' },
    providerAssessments: { core: { availability: 'qualified', searchOutcome: 'complete' }, market: { availability: 'unsupported', searchOutcome: 'not-run' } } } as TradeQuote;
  candidate.providerCandidates = { core: candidate as Extract<TradeQuote, { strategy: 'core' }> };
  const summaries = providerSummaries(candidate), capture = captureSelection({ quote: candidate, attemptId: 'safe-attempt' });
  const scenario = buildMatrix(config, valuation)[0];
  const result: ScenarioResult = { ...resultFor(scenario, 'execution'), ...capture.primary, status: 'pass', transactionHash: '0x' + '1'.repeat(64),
    executionTerms: terms, wallet: { inputBefore: [], inputAfter: [], outputBefore: [], outputAfter: [], inputDelta: [], outputDelta: [], nativeGasPaid: gas.nativeAmount, gasTransactionHashes: ['0x' + '1'.repeat(64)] } };
  result.alternateExecution = { ...notAttemptedAlternate(scenario), attempted: true, status: 'pass', executionTerms: terms };
  const before = JSON.stringify({ status: result.status, selectedProvider: result.selectedProvider, bounds: result.bounds, digest: result.planDigest });
  enrichResultQuality(result, valuation, config); enrichResultQuality(result, valuation, config);
  assert.equal(result.quoteQuality!.economicPct, '95.000000000000'); assert.equal(result.providers!.core.quoteQuality!.economicPct, '95.000000000000');
  assert.equal(result.executionQuality!.netPct, '86.363636363636');
  assert.equal(result.alternateExecution.executionQuality!.economicPct, '95.000000000000');
  assert.equal(result.alternateExecution.executionQuality!.netReason, 'missing-gas');
  assert.equal(JSON.stringify({ status: result.status, selectedProvider: result.selectedProvider, bounds: result.bounds, digest: result.planDigest }), before);
  assert.ok(summaries.core.quoteTerms); assert.doesNotMatch(JSON.stringify(result), /signature|adapterData|providerQuote|providerRequest/);
  result.wallet!.gasTransactionHashes = ['0x' + '2'.repeat(64)]; enrichResultQuality(result, valuation, config);
  assert.equal(result.executionQuality!.netReason, 'missing-gas');
});
