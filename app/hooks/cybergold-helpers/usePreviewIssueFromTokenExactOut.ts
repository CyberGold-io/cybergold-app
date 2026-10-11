"use client";
import type { Address } from "viem";
import { useTokenPreview } from "../protocol/useTokenPreview";
import type { SwapToQuote } from "../../types";

export function usePreviewIssueFromTokenExactOut(opts: {
  inputToken?: Address; maxInputAmount?: bigint; netCygldOut?: bigint;
  quotes?: readonly SwapToQuote[]; nativeInput?: boolean; enabled?: boolean;
}) {
  const { inputToken, maxInputAmount, netCygldOut, quotes, nativeInput = false, enabled = true } = opts;
  const legs = (quotes ?? []).map(({ adapter, amountIn, minimumAmountOut, data }) => ({
    adapter, amountIn: String(amountIn), minimumAmountOut: String(minimumAmountOut), data,
  }));
  const request = nativeInput
    ? { mode: "issue-native-exact-out" as const, maximumNativeIn: String(maxInputAmount ?? 0n), netCygldOut: String(netCygldOut ?? 0n), quotes: legs }
    : { mode: "issue-token-exact-out" as const, inputToken: inputToken ?? "", maximumInputAmount: String(maxInputAmount ?? 0n), netCygldOut: String(netCygldOut ?? 0n), quotes: legs };
  return useTokenPreview(request, Boolean(enabled &&
    (nativeInput || inputToken) && maxInputAmount !== undefined && netCygldOut !== undefined && quotes),
    { staleTime: 10_000 });
}
