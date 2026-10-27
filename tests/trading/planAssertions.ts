import { decodeFunctionData, type Address, type Hex } from 'viem';
import { HISTORICAL_HELPERS_EXECUTION_ABI as HELPERS_EXECUTION_ABI } from "../fixtures/helpers-execution-legacy.ts";
import { exactInputPlan } from "../../app/utils/universalExactInput.ts";
import { isEconomicQuote, type EconomicQuote, type PreparedTransaction } from "../../app/utils/economicQuotes.ts";
import { quoteIntentResult } from '../../app/utils/quoteIntent.ts';
import type { TradeSelectionObservation } from '../../app/utils/tradeSelectionObservation.ts';
import { requireInvariant } from './regression.ts';
import type { QuoteObservation } from './quoteObservation.ts';

const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized)
  : typeof value === 'bigint' || typeof value === 'number' ? String(value)
  : typeof value === 'string' && value.startsWith('0x') ? value.toLowerCase()
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, normalized(row)])) : value;
const same = (actual: unknown, expected: unknown, code: string) => requireInvariant(JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected)), code);
const equal = (actual: unknown, expected: unknown) => JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected));
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Ignore acquired quantities/display metadata; retain physical hops and runtime split weights. */
export function economicRoutes(plan: EconomicQuote['plan']) {
  return Object.fromEntries(Object.entries(plan.conversions).map(([operation, value]) => {
    const row = record(value), template = record(row.template);
    const branches = Array.isArray(row.branches) ? row.branches : [];
    return [operation, { inputCurrency: row.inputCurrency, outputCurrency: row.outputCurrency,
      routes: template.routes,
      branches: branches.map(branch => ({ hops: (Array.isArray(record(branch).hops) ? record(branch).hops as unknown[] : []).map(hop => {
        const edge = record(hop), pool = record(edge.pool);
        if (!edge.pool) return { kind: edge.kind, currencyOut: edge.currencyOut };
        return { zeroForOne: edge.zeroForOne, pool: {
          protocol: pool.protocol, identity: pool.protocol === 'v4' ? pool.id : pool.address ?? pool.id,
          poolManager: pool.poolManager, token0: record(pool.token0).address, token1: record(pool.token1).address,
          feePips: pool.feePips, tickSpacing: pool.tickSpacing, hooks: pool.hooks } };
      }) })) }];
  }));
}

const selectedEconomicTerms = (value: EconomicQuote) => ({ intent: value.request.intent,
  outputCurrency: value.request.outputCurrency, inputs: value.inputs,
  allocations: value.plan.allocations, conversions: economicRoutes(value.plan), deployment: value.deployment });

/** The original preparation request links its response to this exact click observation. */
export function observedPreparation(capture: TradeSelectionObservation, owner: Address, observations: readonly QuoteObservation[]) {
  const selected = capture.economicQuote ?? (capture.quote?.strategy === 'universal' && isEconomicQuote(capture.quote) ? capture.quote : undefined);
  if (!selected) return undefined;
  const observed = observations.findLast(row => row.path === '/api/tx-preparations' && row.terminal?.type === 'complete'
    && typeof row.request.sender === 'string' && row.request.sender.toLowerCase() === owner.toLowerCase()
    && equal(record(row.request.quote).request, selected.request)
    && equal(record(row.request.quote).context, selected.context)
    && equal(record(row.request.quote).plan, selected.plan));
  return observed?.terminal?.value as PreparedTransaction | undefined;
}

/** Bind mined economics and routes to the click snapshot. Authorization
 * signatures are deliberately excluded; they are obtained after that click.
 * Current universal plans are compared directly; historical plans use frozen decoding.
 */
export async function assertCapturedTradeInput(capture: TradeSelectionObservation, input: Hex, owner: Address,
  observations: readonly QuoteObservation[] = []) {
  const economic = capture.economicQuote ?? (capture.quote?.strategy === 'universal' && isEconomicQuote(capture.quote) ? capture.quote : undefined);
  if (economic) {
    const prepared = observedPreparation(capture, owner, observations);
    requireInvariant(prepared, 'ui-preparation-not-observed');
    same(selectedEconomicTerms(prepared.economicQuote), selectedEconomicTerms(economic), 'ui-preparation-selected-route-mismatch');
    same(prepared.plan.inputs, economic.inputs, 'ui-preparation-funding-mismatch');
    same(prepared.plan.recipient, owner, 'ui-preparation-recipient-mismatch');
    const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
    requireInvariant(decoded.functionName === 'executeExactInput', 'ui-click-family-mismatch');
    same(decoded.args[0], exactInputPlan(prepared.plan), 'ui-prepared-plan-mismatch');
    return;
  }
  if (capture.universalQuote) {
    const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
    requireInvariant(decoded.functionName === "executeExactInput", "ui-click-family-mismatch");
    same(decoded.args[0], exactInputPlan(capture.universalQuote.plan), "ui-click-universal-plan-mismatch");
    return;
  }
  requireInvariant(capture.quote, 'ui-click-quote-not-observed');
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
  const args = decoded.args as unknown as unknown[];
  const native = decoded.functionName.includes('Native');
  // Frozen historical receipt assertions remain independent of fresh product
  // dispatch, which now refreshes old exact-input intents into universal plans.
  const selected=capture.quote!;
  if(selected.strategy === "universal") {
    requireInvariant(!isEconomicQuote(selected), 'ui-preparation-not-observed');
    requireInvariant(decoded.functionName === "executeExactInput","ui-click-family-mismatch");
    same(args[0],exactInputPlan(selected.plan),"ui-click-universal-plan-mismatch");return;
  }
  if(selected.strategy === "market") {
    requireInvariant(decoded.functionName === (selected.mode === "exact-in" ? "swapExactInput" : "swapExactOutput"),"ui-click-family-mismatch");
    same(args[0],selected.providerQuote.params,"ui-click-market-plan-mismatch");return;
  }
  const request=selected.providerRequest,result=quoteIntentResult(selected.providerQuote,request.slippageBps);
  if(selected.side === "buy") {
    requireInvariant(!native || request.native,"ui-click-funding-mismatch");
    requireInvariant(decoded.functionName.startsWith(native?"issueFromNativeExactOut":"issueFromTokenExactOut"),"ui-click-family-mismatch");
    same(args[0],native?{maximumNativeIn:BigInt(selected.inputMaximum),netCygldOut:result.executionAmount}
      :{inputToken:request.native?request.quoteToken:request.token,maximumInputAmount:BigInt(selected.inputMaximum),netCygldOut:result.executionAmount},"ui-click-core-plan-mismatch");
    same(args[1],{recipient:owner,expectedOrderedCoreAssets:result.orderedCoreAssets},"ui-click-core-asset-binding-mismatch");
    same(args.at(-1),result.quotes.map(leg=>({adapter:leg.adapter,amountIn:leg.amountIn,minimumAmountOut:leg.minimumAmountOut,data:leg.data})),"ui-click-route-mismatch");
    return;
  }
  requireInvariant(decoded.functionName.startsWith(native?"redeemToNativeExactIn":"redeemToTokenExactIn"),"ui-click-family-mismatch");
  const redemption={grossCygldIn:result.executionAmount,recipient:owner,minimumAmountOut:BigInt(selected.outputMinimum),expectedCoreOutputs:result.expectedCoreOutputs};
  same(args[0],native?redemption:{...redemption,outputToken:request.token},"ui-click-core-plan-mismatch");
  same(args.at(-1),result.redemptionQuotes,"ui-click-route-mismatch");
}
