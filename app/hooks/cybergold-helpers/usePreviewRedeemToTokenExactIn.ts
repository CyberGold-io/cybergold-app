"use client";
import type { Address } from "viem";
import { useTokenPreview } from "../protocol/useTokenPreview";
import type { RoutedSwapFromQuote } from "../../types";

export function usePreviewRedeemToTokenExactIn(opts: {
  outputToken?: Address; grossCygldIn?: bigint; quotes?: readonly RoutedSwapFromQuote[];
  nativeOutput?: boolean; enabled?: boolean;
}) {
  const { outputToken, grossCygldIn, quotes, nativeOutput = false, enabled = true } = opts;
  // inputAmount/inputAsset are App routing context, never Helpers calldata.
  const legs = (quotes ?? []).map(({ adapter, minimumAmountOut, data }) => ({
    adapter, minimumAmountOut: String(minimumAmountOut), data,
  }));
  const request = nativeOutput
    ? { mode: "redeem-native-exact-in" as const, grossCygldIn: String(grossCygldIn ?? 0n), quotes: legs }
    : { mode: "redeem-token-exact-in" as const, outputToken: outputToken ?? "", grossCygldIn: String(grossCygldIn ?? 0n), quotes: legs };
  return useTokenPreview(request, Boolean(enabled && (nativeOutput || outputToken) &&
    grossCygldIn !== undefined && quotes !== undefined), { staleTime: 10_000 });
}
