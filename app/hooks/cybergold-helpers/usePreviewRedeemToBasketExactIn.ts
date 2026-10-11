"use client";

import { useBasketPreview } from "@/app/hooks/protocol/useBasketPreview";

export function usePreviewRedeemToBasketExactIn(grossCygldIn: bigint, enabled = true) {
  return useBasketPreview<"redeem-exact-in">({ mode: "redeem-exact-in", grossCygldIn: String(grossCygldIn) },
    enabled && grossCygldIn > 0n);
}
