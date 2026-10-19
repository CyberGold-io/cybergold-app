import { decodeFunctionData, type Address, type Hex } from 'viem';
import { HELPERS_EXECUTION_ABI } from '../../app/contracts/cybergold-helpers/execution.ts';
import { submitTradeQuote } from '../../app/utils/tradeExecution.ts';
import { tradeQuoteResult } from '../../app/utils/tradeQuote.ts';
import type { TradeSelectionObservation } from '../../app/utils/tradeSelectionObservation.ts';
import { requireInvariant } from './regression.ts';

const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized)
  : typeof value === 'bigint' || typeof value === 'number' ? String(value)
  : typeof value === 'string' && value.startsWith('0x') ? value.toLowerCase()
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, normalized(row)])) : value;
const same = (actual: unknown, expected: unknown, code: string) => requireInvariant(JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected)), code);

/** Bind mined economics and routes to the click snapshot. Authorization
 * signatures are deliberately excluded; they are obtained after that click.
 * Uses the product's existing dispatch, with inert executors and no wallet/API.
 */
export async function assertCapturedTradeInput(capture: TradeSelectionObservation, input: Hex, owner: Address) {
  requireInvariant(capture.quote, 'ui-click-quote-not-observed');
  const decoded = decodeFunctionData({ abi: HELPERS_EXECUTION_ABI, data: input });
  const args = decoded.args as unknown as unknown[];
  const native = decoded.functionName.includes('Native');
  await submitTradeQuote({ ...tradeQuoteResult(capture.quote), deployment: capture.deployment },
    { owner, recipient: owner, inputFundingMode: native ? 'native' : 'erc20' }, {
      market: async selected => {
        requireInvariant(decoded.functionName === (capture.quote!.mode === 'exact-in' ? 'swapExactInput' : 'swapExactOutput'), 'ui-click-family-mismatch');
        same(args[0], selected.value.params, 'ui-click-market-plan-mismatch');
        return '0x01';
      },
      tokenPurchase: async selected => {
        requireInvariant(native === selected.nativeInput, 'ui-click-funding-mismatch');
        requireInvariant(decoded.functionName.startsWith(native ? 'issueFromNativeExactOut' : 'issueFromTokenExactOut'), 'ui-click-family-mismatch');
        same(args[0], native ? { maximumNativeIn: selected.maximumInputAmount, netCygldOut: selected.netCygldOut }
          : { inputToken: selected.inputToken, maximumInputAmount: selected.maximumInputAmount, netCygldOut: selected.netCygldOut }, 'ui-click-core-plan-mismatch');
        same(args[1], { recipient: selected.recipient, expectedOrderedCoreAssets: selected.expectedOrderedCoreAssets }, 'ui-click-core-asset-binding-mismatch');
        same(args.at(-1), selected.quotes.map(leg => ({ adapter: leg.adapter, amountIn: leg.amountIn, minimumAmountOut: leg.minimumAmountOut, data: leg.data })), 'ui-click-route-mismatch');
        return '0x01';
      },
      redemption: async selected => {
        requireInvariant(decoded.functionName.startsWith(selected.operation), 'ui-click-family-mismatch');
        same(args[0], selected.request, 'ui-click-core-plan-mismatch');
        same(args.at(-1), selected.legs, 'ui-click-route-mismatch');
        return '0x01';
      },
    });
}
