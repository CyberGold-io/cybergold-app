import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, zeroAddress } from 'viem';
import { HISTORICAL_HELPERS_EXECUTION_ABI as HELPERS_EXECUTION_ABI } from "../../tests/fixtures/helpers-execution-legacy.ts";
import { coreTrade, marketTrade, tradeCounter, tradeOwner } from '../../tests/fixtures/trade-quote.mts';
import { assertCapturedTradeInput } from '../../tests/trading/planAssertions.ts';
import type { TradeQuote } from './tradeQuote.ts';

// Expected ABI arguments are literal fixture economics, independent of the
// product dispatch used by the assertion. No receipt or wallet is simulated.
function inputFor(quote: TradeQuote, differentRoute = false) {
  let functionName: string, args: unknown[];
  if (quote.strategy === 'market') {
    functionName = quote.mode === 'exact-in' ? 'swapExactInput' : 'swapExactOutput';
    const params = { ...quote.providerQuote.params };
    if (differentRoute) params.data = '0xffff';
    args = [params, { mode: 0, nativePermit: { value: 0n, deadline: 0n, v: 0, r: `0x${'00'.repeat(32)}`, s: `0x${'00'.repeat(32)}` },
      permit2: { permit: { permitted: { token: zeroAddress, amount: 0n }, nonce: 0n, deadline: 0n }, signature: '0x' } }];
  } else if (quote.side === 'buy') {
    functionName = quote.providerRequest.native ? 'issueFromNativeExactOut' : 'issueFromTokenExactOut';
    args = [quote.providerRequest.native ? { maximumNativeIn: 30n, netCygldOut: 25n } : { inputToken: tradeCounter, maximumInputAmount: 30n, netCygldOut: 25n },
      { recipient: tradeOwner, expectedOrderedCoreAssets: [tradeCounter] },
      [{ adapter: quote.providerRequest.adapter, amountIn: 20n, minimumAmountOut: 25n, data: differentRoute ? '0xffff' : '0x01' }]];
  } else {
    functionName = 'redeemToTokenExactIn';
    args = [{ outputToken: tradeCounter, grossCygldIn: 20n, recipient: tradeOwner, minimumAmountOut: 24n,
      expectedCoreOutputs: [{ kind: 0, token: tradeCounter, id: 0n, minimumAmount: 24n }] },
      [{ adapter: quote.providerRequest.adapter, minimumAmountOut: 24n, data: differentRoute ? '0xffff' : '0x02' }]];
  }
  return encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName, args } as never);
}

for (const side of ['buy', 'sell'] as const) for (const mode of ['exact-in', 'exact-out'] as const)
  for (const provider of ['core', 'market'] as const) if (provider !== 'core' || side !== 'sell') test(`${provider} ${side} ${mode}: mined call matches the captured economic plan`, async () => {
    const quote = provider === 'core' ? coreTrade(side, mode) : marketTrade(side, mode);
    await assertCapturedTradeInput({ quote }, inputFor(quote), tradeOwner);
  });

for (const provider of ['core', 'market'] as const) test(`${provider}: identical family and bounds cannot hide a different route`, async () => {
  const quote = provider === 'core' ? coreTrade() : marketTrade();
  await assert.rejects(assertCapturedTradeInput({ quote }, inputFor(quote, true), tradeOwner), /ui-click-(?:market-plan|route)-mismatch/);
});

test('native Core funding and its existing wrapped-token fallback stay distinct from ERC20 intent', async () => {
  const token = coreTrade(), native = coreTrade();
  native.providerRequest.native = true; native.providerRequest.token = zeroAddress;
  await assertCapturedTradeInput({ quote: native }, inputFor(native), tradeOwner);
  await assertCapturedTradeInput({ quote: native }, inputFor(token), tradeOwner);
  await assert.rejects(assertCapturedTradeInput({ quote: token }, inputFor(native), tradeOwner), /ui-click-funding-mismatch/);
  assert.equal(token.providerRequest.native, false);
});
