import { createHash } from 'node:crypto';
import { formatUnits } from 'viem';
import type { ProtocolConfiguration } from '../../app/utils/protocolConfiguration.ts';
import type { ProtocolFacts } from '../../app/utils/protocolFacts.ts';
import type { PoolSnapshot } from '../../app/utils/poolSnapshot.ts';
import { pools } from '../../app/config/pools.ts';
import { configuredToken, ScenarioUnavailableError, type Scenario } from './scenarios.ts';

export const tiers = { small: '1', medium: '100', large: '10000' } as const;
export const matrixCounts = matrixCountsFor(activeMatrixTemplates());
export type MatrixScenario = Scenario & { size: keyof typeof tiers; nominalUsd: string; amountRaw: string;
  valuationId: string; sizingError?: 'valuation-unavailable'; basketAmounts?: string[]; basketAssets?: string[] };
type Ratio = { numerator: string; denominator: string };
export type ValuationSnapshot = { id: string; source: 'usdc-anchored-pool-observations'; observedAt: string;
  assumption: 'one-usdc-is-one-usd'; rounding: 'floor-raw-units'; priceUnit?: 'usd-per-raw-unit'; assetDecimals?: Record<string, number>; prices: Record<string, Ratio>;
  basketAssets: string[]; basketWeights: string[]; observations: PoolSnapshot[] };
const ratio = (n: bigint, d = 1n): Ratio => ({ numerator: String(n), denominator: String(d) });
const multiply = (a: Ratio, b: Ratio) => ratio(BigInt(a.numerator) * BigInt(b.numerator), BigInt(a.denominator) * BigInt(b.denominator));
const inverse = (a: Ratio) => ratio(BigInt(a.denominator), BigInt(a.numerator));
const add = (a: Ratio, b: Ratio) => ratio(BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
export const semanticDigest = (value: unknown): string => {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
};

/** Marginal sizing observation, not an executable quotation or a new price policy. */
export function valuationSnapshot(config: ProtocolConfiguration, facts: ProtocolFacts, observations: PoolSnapshot[]): ValuationSnapshot {
  const prices: Record<string, Ratio> = {};
  const usdc = configuredToken(config, 'USDC');
  if (usdc.type !== 'erc20') throw new ScenarioUnavailableError('valuation-unavailable');
  prices[usdc.address.toLowerCase()] = ratio(1n, 10n ** BigInt(usdc.decimals));
  for (let pass = 0; pass < observations.length; pass++) for (const pool of observations) {
    if (!pool.exists) continue;
    const rate = pool.marginalPrice ? ratio(BigInt(pool.marginalPrice.numerator), BigInt(pool.marginalPrice.denominator))
      : pool.sqrtPriceX96Raw ? ratio(BigInt(pool.sqrtPriceX96Raw) ** 2n, 1n << 192n) : undefined;
    if (!rate || BigInt(rate.numerator) <= 0n || BigInt(rate.denominator) <= 0n) continue;
    const a = pool.token0.toLowerCase(), b = pool.token1.toLowerCase();
    if (prices[a] && !prices[b]) prices[b] = multiply(prices[a], inverse(rate));
    if (prices[b] && !prices[a]) prices[a] = multiply(prices[b], rate);
  }
  const assets = facts.basket.assets.status === 'success' ? facts.basket.assets.value : [];
  const weights = facts.basket.targetsPpm.status === 'success' ? facts.basket.targetsPpm.value.map(BigInt) : [];
  const total = weights.reduce((a, b) => a + b, 0n);
  let corePrice = ratio(0n), complete = assets.length > 0 && weights.length === assets.length && total > 0n;
  assets.forEach((asset, i) => {
    const price = prices[asset.toLowerCase()], conversion = BigInt(facts.basket.cygldPerUnitFp18.status === 'success' ? facts.basket.cygldPerUnitFp18.value[i] : '0');
    if (!price || conversion <= 0n || weights[i] === undefined || total === 0n) { complete = false; return; }
    corePrice = add(corePrice, multiply(price, ratio(weights[i] * 10n ** 18n, total * conversion)));
  });
  const cygld = configuredToken(config, 'CYGLD');
  if (cygld.type !== 'erc20') throw new ScenarioUnavailableError('valuation-unavailable');
  if (complete) prices[cygld.address.toLowerCase()] = corePrice;
  const body = { source: 'usdc-anchored-pool-observations' as const, observedAt: facts.context.observedAt,
    assumption: 'one-usdc-is-one-usd' as const, rounding: 'floor-raw-units' as const,
    priceUnit: 'usd-per-raw-unit' as const, assetDecimals: Object.fromEntries(config.tokens.flatMap(token => token.type === 'erc20' ? [[token.address.toLowerCase(), token.decimals]] : [])),
    prices, basketAssets: assets, basketWeights: weights.map(String), observations };
  return { id: semanticDigest(body), ...body };
}

export async function readValuation(config: ProtocolConfiguration, facts: ProtocolFacts, fetcher: typeof fetch) {
  const reads = await Promise.allSettled(pools.map(async pool => {
    const a = configuredToken(config, pool.token0), b = configuredToken(config, pool.token1);
    if (a.type !== 'erc20' || b.type !== 'erc20') throw new ScenarioUnavailableError('valuation-unavailable');
    const response = await fetcher('/api/pools/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenA: a.address, tokenB: b.address, fee: pool.fee }), cache: 'no-store' });
    if (!response.ok) throw new ScenarioUnavailableError('valuation-unavailable');
    return response.json() as Promise<PoolSnapshot>;
  }));
  const observations = reads.flatMap(read => read.status === 'fulfilled' ? [read.value] : []);
  return valuationSnapshot(config, facts, observations);
}

/** Complete retained capability definitions, including deferred output intents. */
export function matrixTemplates(): Scenario[] {
  return (['PAXG', 'USDC', 'ETH', 'BASKET'] as const).flatMap(asset => (['buy', 'sell'] as const).flatMap(side =>
    (['exact-in', 'exact-out'] as const).flatMap(inputMode => Object.entries(tiers).map(([size]) => ({
      id: `core-${side === 'buy' ? 'issue' : 'redeem'}-${asset.toLowerCase()}-${inputMode}-${size}`,
      family: asset === 'BASKET' ? side === 'buy' ? 'issue-basket' as const : 'redeem-basket' as const : side === 'buy' ? 'issue-token' as const : 'redeem-token' as const,
      requestedStrategy: 'core' as const, side, inputMode, asset, displayAmount: '0', size: size as keyof typeof tiers, nominalUsd: tiers[size as keyof typeof tiers],
    })))));
}

/** Operating journeys use spend intents; named producer diagnostics remain separate. */
export function activeScenarios<T extends Scenario>(scenarios: readonly T[]): T[] {
  return scenarios.filter(scenario => scenario.inputMode === 'exact-in');
}

export function activeMatrixTemplates(): Scenario[] {
  return activeScenarios(matrixTemplates());
}

export function matrixCountsFor(scenarios: readonly Scenario[], providerCount = 2) {
  return { scenarioCount: scenarios.length, providerAssessmentCount: scenarios.length * providerCount,
    maximumTradeExecutions: scenarios.length * providerCount };
}

/** Match the product's first-component driver and ordered integer basket derivation. */
export function buildMatrix(config: ProtocolConfiguration, valuation: ValuationSnapshot,
  templates: readonly Scenario[] = activeMatrixTemplates()): MatrixScenario[] {
  const price = (symbol: string) => {
    const token = configuredToken(config, symbol === 'ETH' ? 'WETH' : symbol);
    const p = token.type === 'erc20' ? valuation.prices[token.address.toLowerCase()] : undefined;
    if (!p || BigInt(p.numerator) <= 0n || BigInt(p.denominator) <= 0n) throw new ScenarioUnavailableError('valuation-unavailable');
    return p;
  };
  return templates.map(template => {
    const size = template.id.split('-').at(-1) as keyof typeof tiers, nominalUsd = tiers[size];
    try {
    const basketEdited = template.asset === 'BASKET' && (template.side === 'buy') === (template.inputMode === 'exact-in');
    const editedSymbol = (template.side === 'buy') !== (template.inputMode === 'exact-in') ? 'CYGLD' : template.asset;
    if (!basketEdited) {
      const token = configuredToken(config, editedSymbol), p = price(editedSymbol);
      const raw = BigInt(nominalUsd) * BigInt(p.denominator) / BigInt(p.numerator);
      return { ...template, size, nominalUsd, valuationId: valuation.id, amountRaw: String(raw), displayAmount: formatUnits(raw, token.decimals) };
    }
    const tokens = valuation.basketAssets.map(asset => config.tokens.find(token => token.type === 'erc20' && token.address.toLowerCase() === asset.toLowerCase())!);
    const weights = valuation.basketWeights.map(BigInt), first = tokens[0];
    if (!first || weights[0] <= 0n) throw new ScenarioUnavailableError('valuation-unavailable');
    let unitPrice = ratio(0n);
    tokens.forEach((token, i) => {
      if (!token || token.type !== 'erc20' || !valuation.prices[token.address.toLowerCase()]) throw new ScenarioUnavailableError('valuation-unavailable');
      unitPrice = add(unitPrice, multiply(valuation.prices[token.address.toLowerCase()], ratio(weights[i] * 10n ** BigInt(token.decimals), weights[0] * 10n ** BigInt(first.decimals))));
    });
    if (BigInt(unitPrice.numerator) <= 0n) throw new ScenarioUnavailableError('valuation-unavailable');
    const raw = BigInt(nominalUsd) * BigInt(unitPrice.denominator) / BigInt(unitPrice.numerator);
    const basketAmounts = tokens.map((token, i) => String(raw * weights[i] * 10n ** BigInt(token.decimals) / (weights[0] * 10n ** BigInt(first.decimals))));
    return { ...template, size, nominalUsd, valuationId: valuation.id, amountRaw: String(raw), displayAmount: formatUnits(raw, first.decimals), basketAmounts, basketAssets: [...valuation.basketAssets] };
    } catch (error) {
      if (!(error instanceof ScenarioUnavailableError)) throw error;
      return { ...template, size, nominalUsd, valuationId: valuation.id, amountRaw: '0', sizingError: 'valuation-unavailable' as const };
    }
  });
}

export function repetitionManifest(input: { repetitions: number; concurrency: number; condition: 'cold' | 'warm'; preserved: string[]; reset: string[] }) {
  if (!Number.isSafeInteger(input.repetitions) || input.repetitions < 1 || !Number.isSafeInteger(input.concurrency) || input.concurrency < 1) throw new Error('invalid-repetition-manifest');
  return structuredClone(input);
}

/** Test assertions over the actual clicked request, not a second quotation. */
export function assertMatrixIntent(scenario: MatrixScenario, observation: { intent?: import('../../app/utils/tradeQuote.ts').TradeQuoteRequest; basketRequest?: import('../../app/utils/basketPreview.ts').BasketPreviewRequest; universalQuote?: import('../../app/utils/universalExactInput.ts').UniversalExactInputQuote }, config: ProtocolConfiguration) {
  const fail = () => { throw new Error('matrix-intent-mismatch'); };
  if (scenario.asset !== 'BASKET') {
    const intent = observation.intent, counter = configuredToken(config, scenario.asset === 'ETH' ? 'WETH' : scenario.asset);
    if (!intent || counter.type !== 'erc20' || intent.side !== scenario.side || intent.mode !== scenario.inputMode || intent.amount !== scenario.amountRaw
      || intent.counterToken.toLowerCase() !== counter.address.toLowerCase() || intent.native !== (scenario.asset === 'ETH')) fail();
    return;
  }
  if (observation.universalQuote) {
    const plan = observation.universalQuote.plan;
    if (plan.intent !== (scenario.side === 'buy' ? 2 : 3)) return fail();
    if (scenario.side === 'buy') {
      if (plan.inputs.length !== scenario.basketAmounts?.length || !plan.inputs.every((row,index) => row.amount === scenario.basketAmounts![index] && row.currency.toLowerCase() === scenario.basketAssets?.[index].toLowerCase())) fail();
    } else if (plan.inputs.length !== 1 || plan.inputs[0].amount !== scenario.amountRaw || plan.inputs[0].currency.toLowerCase() !== config.contracts.core?.toLowerCase()) fail();
    return;
  }
  const request = observation.basketRequest;
  if (!request || request.mode !== `${scenario.side === 'buy' ? 'issue' : 'redeem'}-${scenario.inputMode}`) return fail();
  if (request.mode === 'issue-exact-out') { if (request.netCygldOut !== scenario.amountRaw) fail(); }
  else if (request.mode === 'redeem-exact-in') { if (request.grossCygldIn !== scenario.amountRaw) fail(); }
  else if (request.mode === 'issue-exact-in') { if (JSON.stringify(request.maximumAmountsIn) !== JSON.stringify(scenario.basketAmounts)) fail(); }
  else if (!scenario.basketAmounts?.every((amount, i) => request.minimumOutputs.some(row => row.kind === 0 && row.token.toLowerCase() === scenario.basketAssets?.[i].toLowerCase() && row.minimumAmount === amount))) fail();
}
