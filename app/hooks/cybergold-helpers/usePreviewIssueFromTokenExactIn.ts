"use client";
import type { Address } from "viem";
import { useTokenPreview } from "../protocol/useTokenPreview";
import type { SwapToQuote } from "../../types";

export function usePreviewIssueFromTokenExactIn(opts: {
  inputToken?: Address; inputAmount?: bigint; quotes?: readonly SwapToQuote[];
  nativeInput?: boolean; enabled?: boolean;
}) {
  const { inputToken, inputAmount, quotes, nativeInput = false, enabled = true } = opts;
  const legs = (quotes ?? []).map(({ adapter, amountIn, minimumAmountOut, data }) => ({
    adapter, amountIn: String(amountIn), minimumAmountOut: String(minimumAmountOut), data,
  }));
  const request = nativeInput
    ? { mode: "issue-native-exact-in" as const, inputAmount: String(inputAmount ?? 0n), quotes: legs }
    : { mode: "issue-token-exact-in" as const, inputToken: inputToken ?? "", inputAmount: String(inputAmount ?? 0n), quotes: legs };
  return useTokenPreview(request, Boolean(enabled &&
    (nativeInput || inputToken) && inputAmount !== undefined && quotes), { staleTime: 10_000 });
}
