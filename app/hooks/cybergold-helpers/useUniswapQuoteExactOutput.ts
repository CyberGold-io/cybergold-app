"use client";
import { useCallback } from "react";
import { fetchUniswapQuote } from "../../utils/uniswapQuote";

export function useUniswapQuoteExactOutput() {
  return useCallback(async (params: { path: `0x${string}`; amountOut: bigint; signal?: AbortSignal }) =>
    fetchUniswapQuote({ mode: "exact-out", path: params.path, amount: String(params.amountOut) }, params.signal), []);
}
