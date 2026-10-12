import type { TradeQuote } from "../../app/utils/tradeQuote.ts";
import { marketFixtureQuote, marketFixtureRequest } from "./market-quote.mts";

export const tradeOwner = "0x0000000000000000000000000000000000000001" as const;
export const tradeHelpers = "0x0000000000000000000000000000000000000002" as const;
export const tradeCore = "0x0000000000000000000000000000000000000003" as const;
export const tradeCounter = "0x0000000000000000000000000000000000000004" as const;
export const tradeContext = { chainId: 1, blockNumber: "100", blockHash: `0x${"aa".repeat(32)}`, observedAt: "2026-10-11T00:00:00Z" };

export function coreTrade(side: "buy" | "sell" = "buy", mode: "exact-in" | "exact-out" = "exact-in"): Extract<TradeQuote, { strategy: "core" }> {
  const fees = { protocolFeeCygld: "2", helperFeeCygld: "1" };
  return { strategy: "core", side, mode, tokenIn: side === "buy" ? tradeCounter : tradeCore,
    tokenOut: side === "buy" ? tradeCore : tradeCounter, quotedInput: "20", quotedOutput: "25", inputMaximum: "30", outputMinimum: "24",
    context: tradeContext, evaluation: { core: "complete", market: "unavailable" }, metrics: { totalMs: 1, targetReads: 0 },
    providerRequest: { mode: `${side === "buy" ? "issue" : "redeem"}-${mode}`, token: tradeCounter,
      quoteToken: tradeCounter, native: false, amount: "20", adapter: marketFixtureRequest.adapter,
      deadline: "1900000000", orderedAssets: [tradeCounter], targets: [], slippageBps: 100 },
    providerQuote: { mode: `${side === "buy" ? "issue" : "redeem"}-${mode}`, context: tradeContext,
      quotes: side === "buy" ? [{ adapter: marketFixtureRequest.adapter, outputAsset: tradeCounter,
        amountIn: "20", minimumAmountOut: "25", data: "0x01" }] : [{ adapter: marketFixtureRequest.adapter,
        inputAsset: tradeCounter, inputAmount: "25", minimumAmountOut: "24", data: "0x02" }],
      preview: side === "buy" ? { netCygldOut: "25", fees, orderedCoreAssets: [tradeCounter] }
        : { minimumAmountOut: "24", fees, projectedCoreOutputs: [{ kind: 0, token: tradeCounter, id: "0", amount: "25" }] },
      initialPreview: null, basketPreview: { fees, amountsInExact: ["20"], orderedCoreAssets: [tradeCounter] },
      displayAmount: "999", expectedInputAmount: "18", expectedOutputAmount: "25",
      executionAmount: side === "buy" ? "25" : "20", maximumInputAmount: "30", slippageBps: 100,
      expectedCoreOutputs: [{ kind: 0, token: tradeCounter, id: "0", minimumAmount: "24" }],
      metrics: { rpcReads: 1, rpcReadsRequested: 1, rpcReadsCoalesced: 0, rpcReadsReused: 0, candidateCalls: 1, iterations: 0, totalMs: 1 } } };
}

export function marketTrade(side: "buy" | "sell" = "sell", mode: "exact-in" | "exact-out" = "exact-in"): Extract<TradeQuote, { strategy: "market" }> {
  const quote = { ...marketFixtureQuote, side, mode,
    params: { ...marketFixtureQuote.params, side: side === "buy" ? 0 as const : 1 as const, recipient: tradeOwner } };
  return { strategy: "market", side, mode, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut,
    quotedInput: quote.totalInput, quotedOutput: quote.netOutput, inputMaximum: quote.inputMaximum, outputMinimum: quote.outputMinimum,
    context: quote.context, evaluation: { core: "unavailable", market: "complete" }, metrics: { totalMs: 1, targetReads: 0 },
    providerRequest: { ...marketFixtureRequest, side, mode, recipient: tradeOwner, slippageBps: 100 }, providerQuote: quote };
}
