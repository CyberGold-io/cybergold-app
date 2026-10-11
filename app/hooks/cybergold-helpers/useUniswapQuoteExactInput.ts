"use client";
import { useCallback } from "react";
import { fetchUniswapQuote } from "../../utils/uniswapQuote";

export function useUniswapQuoteExactInput() {
  return useCallback(async (params: { path: `0x${string}`; amountIn: bigint; signal?: AbortSignal }) =>
    fetchUniswapQuote({ mode: "exact-in", path: params.path, amount: String(params.amountIn) }, params.signal), []);
}
