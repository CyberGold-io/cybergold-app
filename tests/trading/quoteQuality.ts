import { zeroAddress } from 'viem';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import type { BasketPreview, BasketPreviewRequest } from '../../app/utils/basketPreview.ts';
import type { TradeQuote } from '../../app/utils/tradeQuote.ts';
import type { ValuationSnapshot } from './matrix.ts';
import type { ScenarioResult } from './regression.ts';

export type QualityAmount = { asset: string; amount: string; kind?: number; id?: string };
/** Lossless public economic terms only. Never calldata, signatures or wallet payloads. */
export type QualityTerms = {
  inputSpent?: QualityAmount[]; netOutput?: QualityAmount[]; inputMaximum?: QualityAmount[];
  requestedInput?: QualityAmount[]; refundCoverage: QualityMeasurement['refundCoverage'];
};
type EconomicCandidate = Pick<TradeQuote, 'side' | 'mode' | 'tokenIn' | 'tokenOut' | 'quotedInput' | 'quotedOutput' | 'inputMaximum'> & (
  Pick<Extract<TradeQuote, { strategy: 'core' }>, 'strategy' | 'providerQuote'> & { providerRequest: { native: boolean; amount: string } }
  | Pick<Extract<TradeQuote, { strategy: 'market' }>, 'strategy' | 'providerQuote'> & { providerRequest: { amount: string } });
export type QualityMeasurement = {
  version: 1; basis: 'quoted' | 'settled'; valueBasis: 'disclosed-quoted-terms' | 'receipt-net-transfers-and-refunds';
  economicState: 'available' | 'unavailable'; netState: 'available' | 'unavailable';
  economicPct?: string; netPct?: string; economicReason?: string; netReason?: string;
  inputSpentUsd?: string; netOutputUsd?: string; userGasUsd?: string; inputMaximumUsd?: string; requestedInputUsd?: string;
  inputUsePct?: string; inputUseState: 'partial' | 'full' | 'exceeded' | 'not-applicable' | 'unavailable';
  gasBasis: 'not-observed' | 'estimate' | 'actual-observed-receipts';
  gasScope: 'not-observed' | 'trade-and-observed-approvals' | 'trade-only';
  refundCoverage: 'not-disclosed' | 'observed-helper-refunds' | 'not-observed';
  priceCoverage: 'complete' | 'incomplete'; pricedAssets: string[]; missingAssets: string[];
  valuationId?: string; valuationSource?: string; valuationObservedAt?: string; valuationAssumption?: string;
  precisionDecimals: 12; rounding: 'floor';
};
type Ratio = { n: bigint; d: bigint };
const ratio = (n: bigint, d = 1n): Ratio => ({ n, d });
const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const divide = (a: Ratio, b: Ratio) => ratio(a.n * b.d, a.d * b.n);
const compare = (a: Ratio, b: Ratio) => a.n * b.d - b.n * a.d;
const decimal = (a: Ratio) => {
  const scaled = a.n * 10n ** 12n / a.d;
  return `${scaled / 10n ** 12n}.${String(scaled % 10n ** 12n).padStart(12, '0')}`;
};
const percent = (a: Ratio, b: Ratio) => decimal(divide(ratio(a.n * 100n, a.d), b));
const uint = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const amount = (asset: string, raw: string): QualityAmount => ({ asset: asset.toLowerCase(), amount: raw });

/** These are diagnostics, never quotation admission, provider selection or pruning. */
export function measureQuality(terms: QualityTerms | undefined, valuation: ValuationSnapshot | undefined,
  config: ProtocolConfiguration, basis: QualityMeasurement['basis'],
  gas?: { nativeAmount: string; basis: 'estimate' | 'actual-observed-receipts'; scope: Exclude<QualityMeasurement['gasScope'], 'not-observed'> }): QualityMeasurement {
  const result: QualityMeasurement = { version: 1, basis,
    valueBasis: basis === 'quoted' ? 'disclosed-quoted-terms' : 'receipt-net-transfers-and-refunds',
    economicState: 'unavailable', netState: 'unavailable', inputUseState: terms?.requestedInput ? 'unavailable' : 'not-applicable',
    gasBasis: gas?.basis ?? 'not-observed', gasScope: gas?.scope ?? 'not-observed',
    refundCoverage: terms?.refundCoverage ?? 'not-observed', priceCoverage: 'incomplete', pricedAssets: [], missingAssets: [],
    precisionDecimals: 12, rounding: 'floor',
    ...(valuation ? { valuationId: valuation.id, valuationSource: valuation.source, valuationObservedAt: valuation.observedAt,
      valuationAssumption: valuation.assumption } : {}) };
  const unavailable = (reason: string) => { result.economicReason = reason; result.netReason = reason; return result; };
  if (!valuation) return unavailable('valuation-unavailable');
  if (!terms?.inputSpent?.length) return unavailable('input-spend-not-observed');
  if (!terms.netOutput?.length) return unavailable('output-not-observed');
  const priced = new Set<string>(), missing = new Set<string>();
  const value = (rows: QualityAmount[] | undefined): Ratio | undefined => {
    if (!rows) return;
    let total = ratio(0n), complete = true;
    for (const row of rows) {
      if (!uint(row.amount)) { complete = false; continue; }
      if (BigInt(row.amount) === 0n) continue;
      const asset = row.asset.toLowerCase();
      const wrapped = config.tokens.find(token => token.type === 'erc20' && token.symbol.toUpperCase() === 'WETH');
      const priceAsset = asset === zeroAddress && wrapped?.type === 'erc20' ? wrapped.address.toLowerCase() : asset;
      const price = valuation.prices[priceAsset];
      if (row.kind !== undefined && row.kind !== 0 || row.id !== undefined && row.id !== '0'
        || !price || !uint(price.numerator) || !uint(price.denominator) || BigInt(price.numerator) === 0n || BigInt(price.denominator) === 0n) {
        missing.add(asset); complete = false; continue;
      }
      priced.add(asset);
      total = add(total, ratio(BigInt(row.amount) * BigInt(price.numerator), BigInt(price.denominator)));
    }
    return complete ? total : undefined;
  };
  const spent = value(terms.inputSpent), output = value(terms.netOutput), requested = value(terms.requestedInput), maximum = value(terms.inputMaximum);
  const gasValue = gas && uint(gas.nativeAmount) ? value([amount(zeroAddress, gas.nativeAmount)]) : undefined;
  result.pricedAssets = [...priced].sort(); result.missingAssets = [...missing].sort();
  result.priceCoverage = missing.size ? 'incomplete' : 'complete';
  if (spent) result.inputSpentUsd = decimal(spent);
  if (output) result.netOutputUsd = decimal(output);
  if (requested) result.requestedInputUsd = decimal(requested);
  if (maximum) result.inputMaximumUsd = decimal(maximum);
  if (gasValue) result.userGasUsd = decimal(gasValue);
  if (spent && requested && requested.n > 0n) {
    result.inputUsePct = percent(spent, requested);
    const difference = compare(spent, requested);
    result.inputUseState = difference < 0n ? 'partial' : difference > 0n ? 'exceeded' : 'full';
  }
  if (!spent || !output) return unavailable('missing-price');
  if (spent.n === 0n) return unavailable('zero-input-value');
  if (basis === 'settled' && terms.refundCoverage !== 'observed-helper-refunds') return unavailable('refund-evidence-unavailable');
  result.economicState = 'available'; result.economicPct = percent(output, spent);
  if (!gas || !uint(gas.nativeAmount)) result.netReason = 'missing-gas';
  else if (!gasValue) result.netReason = 'missing-gas-price';
  else { result.netState = 'available'; result.netPct = percent(output, add(spent, gasValue)); }
  return result;
}

/** Producer totals already include CYGLD fees. Only disclosed dust/refunds adjust them. */
function observedTradeQualityTerms(candidate: EconomicCandidate): QualityTerms {
  if (!candidate || typeof candidate.tokenIn !== 'string' || typeof candidate.tokenOut !== 'string'
    || !candidate.providerQuote || !candidate.providerRequest) return { refundCoverage: 'not-disclosed' };
  const inputAsset = candidate.strategy === 'core' && candidate.providerRequest.native && candidate.side === 'buy'
    ? zeroAddress : candidate.tokenIn;
  const outputAsset = candidate.strategy === 'core' && candidate.providerRequest.native && candidate.side === 'sell'
    ? zeroAddress : candidate.tokenOut;
  let spent: string | undefined = candidate.quotedInput, output = candidate.quotedOutput;
  if (candidate.strategy === 'core' && candidate.side === 'buy') spent = candidate.providerQuote.expectedInputAmount;
  if (candidate.strategy === 'market') {
    const quote = candidate.providerQuote;
    if (uint(spent) && uint(quote.refundDust) && BigInt(spent) >= BigInt(quote.refundDust)) spent = String(BigInt(spent) - BigInt(quote.refundDust));
    if (uint(output) && uint(quote.outputRefundEstimate)) output = String(BigInt(output) + BigInt(quote.outputRefundEstimate));
  }
  const recovery = candidate.strategy === 'core' && candidate.providerQuote.preview && 'projectedCoreOutputs' in candidate.providerQuote.preview
    ? candidate.providerQuote.preview.projectedCoreOutputs.filter(row => row.kind !== 0 || row.id !== '0').map(row => ({ asset: row.token.toLowerCase(), amount: row.amount, kind: row.kind, id: row.id })) : [];
  return { ...(spent ? { inputSpent: [amount(inputAsset, spent)] } : {}), netOutput: [amount(outputAsset, output), ...recovery],
    inputMaximum: [amount(inputAsset, candidate.inputMaximum)],
    ...(candidate.mode === 'exact-in' ? { requestedInput: [amount(inputAsset, candidate.providerRequest.amount)] } : {}), refundCoverage: 'not-disclosed' };
}

function observedBasketQualityTerms(preview: BasketPreview, request: BasketPreviewRequest, cygld: string): QualityTerms {
  if (preview.mode === 'issue-exact-in' || preview.mode === 'issue-exact-out') {
    const input = preview.result.orderedCoreAssets.map((asset, i) => amount(asset, preview.result.amountsInExact[i]));
    const net = preview.mode === 'issue-exact-in' ? preview.result.netCygldOut : request.mode === 'issue-exact-out' ? request.netCygldOut : undefined;
    return { inputSpent: input, ...(net ? { netOutput: [amount(cygld, net)] } : {}),
      inputMaximum: request.mode === 'issue-exact-in' ? input.map((row, i) => amount(row.asset, request.maximumAmountsIn[i])) : input,
      ...(request.mode === 'issue-exact-in' ? { requestedInput: input.map((row, i) => amount(row.asset, request.maximumAmountsIn[i])) } : {}), refundCoverage: 'not-disclosed' };
  }
  const gross = preview.mode === 'redeem-exact-out' ? preview.result.grossCygldIn : request.mode === 'redeem-exact-in' ? request.grossCygldIn : undefined;
  return { ...(gross ? { inputSpent: [amount(cygld, gross)], inputMaximum: [amount(cygld, gross)] } : {}),
    netOutput: preview.result.projectedCoreOutputs.map(row => ({ asset: row.token.toLowerCase(), amount: row.amount, kind: row.kind, id: row.id })),
    ...(request.mode === 'redeem-exact-in' ? { requestedInput: [amount(cygld, request.grossCygldIn)] } : {}), refundCoverage: 'not-disclosed' };
}

/** Missing optional economic evidence never replaces ordinary quote validation. */
export function tradeQualityTerms(candidate: EconomicCandidate): QualityTerms {
  try { return observedTradeQualityTerms(candidate); } catch { return { refundCoverage: 'not-disclosed' }; }
}
export function basketQualityTerms(preview: BasketPreview, request: BasketPreviewRequest, cygld: string): QualityTerms {
  try { return observedBasketQualityTerms(preview, request, cygld); } catch { return { refundCoverage: 'not-disclosed' }; }
}

/** Event net input already excludes input refunds; outputRefund may already be in net output.
 * Only remaining non-input DustRefunded amounts add to received value, once.
 */
export function receiptQualityTerms(terms: Omit<QualityTerms, 'refundCoverage'>,
  refunds: { asset: string; amount: string }[] | undefined, includedOutputRefunds: QualityAmount[] = []): QualityTerms {
  const inputAssets = new Set(terms.inputSpent?.map(row => row.asset.toLowerCase())), included = new Map<string, bigint>();
  for (const row of includedOutputRefunds) if (uint(row.amount)) included.set(row.asset.toLowerCase(), (included.get(row.asset.toLowerCase()) ?? 0n) + BigInt(row.amount));
  const extra = (refunds ?? []).flatMap(row => {
    const asset = row.asset.toLowerCase();
    if (inputAssets.has(asset) || !uint(row.amount)) return [];
    const overlap = included.get(asset) ?? 0n, raw = BigInt(row.amount), consumed = raw < overlap ? raw : overlap;
    included.set(asset, overlap - consumed);
    return raw > consumed ? [amount(asset, String(raw - consumed))] : [];
  });
  return { ...terms, netOutput: terms.netOutput && [...terms.netOutput, ...extra],
    refundCoverage: refunds ? 'observed-helper-refunds' : 'not-observed' };
}

/** Enrich repeated checkpoints and final reports from captured data, without new reads. */
export function enrichResultQuality(result: ScenarioResult, valuation: ValuationSnapshot | undefined, config: ProtocolConfiguration): void {
  const measured = (terms: QualityTerms, basis: QualityMeasurement['basis'], gas?: Parameters<typeof measureQuality>[4]) => {
    try { return measureQuality(terms, valuation, config, basis, gas); }
    catch {
      const unavailable = measureQuality(undefined, undefined, config, basis);
      unavailable.economicReason = unavailable.netReason = 'invalid-quality-evidence';
      return unavailable;
    }
  };
  const provider = result.selectedProvider ?? (result.asset === 'BASKET' ? 'core' : result.actualStrategy);
  if (provider === 'core' || provider === 'market') result.quoteTerms ??= result.providers?.[provider]?.quoteTerms;
  if (result.quoteTerms) result.quoteQuality = measured(result.quoteTerms, 'quoted');
  for (const provider of Object.values(result.providers ?? {})) if (provider.quoteTerms)
    provider.quoteQuality = measured(provider.quoteTerms, 'quoted');
  if (result.executionTerms) {
    const wallet = result.wallet, tradeGasObserved = Array.isArray(wallet?.gasTransactionHashes)
      && wallet.gasTransactionHashes.some(hash => typeof hash === 'string' && hash.toLowerCase() === result.transactionHash?.toLowerCase());
    const gas = tradeGasObserved && uint(wallet!.nativeGasPaid)
      ? { nativeAmount: wallet!.nativeGasPaid, basis: 'actual-observed-receipts' as const, scope: 'trade-and-observed-approvals' as const } : undefined;
    result.executionQuality = measured(result.executionTerms, 'settled', gas);
  }
  if (result.alternateExecution) enrichResultQuality(result.alternateExecution, valuation, config);
}
