import type { MarketQuote, MarketQuoteRequest } from "../../app/utils/marketQuote.ts";

export const address = `0x${"a".repeat(40)}` as const, cygld = `0x${"b".repeat(40)}` as const;
export const context = { chainId: 1, blockNumber: "100", blockHash: `0x${"c".repeat(64)}`, observedAt: "2026-10-10T00:00:00Z" };
export const marketFixtureRequest: MarketQuoteRequest & { adapter: string } = { side: "sell", mode: "exact-in", counterToken: address,
  amount: "1002", adapter: address, recipient: address, deadline: "1900000000", slippageBps: 100 };
export const marketFixtureQuote: MarketQuote = {
  operation: "market", side: "sell", mode: "exact-in", tokenIn: cygld, tokenOut: address,
  amountIn: "1000", amountOut: "2000", totalInput: "1001", netOutput: "2000", grossOutput: "2000", routedAmountIn: "1000",
  inputMaximum: "1002", outputMinimum: "1980", refundDust: "1", adapterData: "0xab", qualification: "sdk",
  fee: { asset: cygld, ratePpm: 1000, amount: "1", basis: "quoted", notional: "1000" },
  params: { side: 1, counterToken: address, amount: "1002", bound: "1980", routedInput: "1000", feeCygld: "1",
    recipient: address, deadline: "1900000000", adapter: address, data: "0xab" },
  plan: { side: "sell", mode: "exact-in", amount: "1002", slippageBps: 100,
    fee: { asset: cygld, ratePpm: 1000, amount: "1", basis: "quoted", notional: "1000" },
    params: { side: 1, counterToken: address, amount: "1002", bound: "1980", routedInput: "1000", feeCygld: "1",
      recipient: address, deadline: "1900000000", adapter: address, data: "0xab" },
    route: { version: 1, executionContext: "helpers-market", mode: "exactIn", tokenIn: cygld, tokenOut: address,
      inputAmount: "1000", outputAmount: "2000", limit: "1980", deadline: "1900000000",
      branches: [{ amountIn: "1000", hops: [{ zeroForOne: true, pool: { id: "pool", protocol: "v4",
        token0: { address: cygld, decimals: 18, chainId: 1 }, token1: { address, decimals: 18, chainId: 1 },
        feePips: 100, tickSpacing: 1, hooks: `0x${"0".repeat(40)}`, poolManager: address } }] }] } },
  context, metrics: { candidateCalls: 1, totalMs: 1 }, feeBeneficiaryDisplay: { address, observedAt: context.observedAt },
};

