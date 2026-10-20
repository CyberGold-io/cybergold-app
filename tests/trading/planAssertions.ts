import { decodeFunctionData, type Address, type Hex } from 'viem';
import { HISTORICAL_HELPERS_EXECUTION_ABI as HELPERS_EXECUTION_ABI } from "../fixtures/helpers-execution-legacy.ts";
import { exactInputPlan } from "../../app/utils/universalExactInput.ts";
import { quoteIntentResult } from '../../app/utils/quoteIntent.ts';
import type { TradeSelectionObservation } from '../../app/utils/tradeSelectionObservation.ts';
import { requireInvariant } from './regression.ts';

const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized)
  : typeof value === 'bigint' || typeof value === 'number' ? String(value)
  : typeof value === 'string' && value.startsWith('0x') ? value.toLowerCase()
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, normalized(row)])) : value;
const same = (actual: unknown, expected: unknown, code: string) => requireInvariant(JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected)), code);

/** Bind mined economics and routes to the click snapshot. Authorization
 * signatures are deliberately excluded; they are obtained after that click.
 * Current universal plans are compared directly; historical plans use frozen decoding.
 */
export async function assertCapturedTradeInput(capture: TradeSelectionObservation, input: Hex, owner: Address) {
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
