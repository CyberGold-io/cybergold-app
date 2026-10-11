"use client";

import { useBasketPreview } from "@/app/hooks/protocol/useBasketPreview";
import type { CoreTokenMinimum } from "@/app/types";

export function usePreviewRedeemToBasketExactOut(minimumOutputs: readonly CoreTokenMinimum[], enabled = true) {
  return useBasketPreview<"redeem-exact-out">({ mode: "redeem-exact-out", minimumOutputs: minimumOutputs.map(row => ({
    kind: row.kind, token: row.token, id: String(row.id), minimumAmount: String(row.minimumAmount),
  })) }, enabled && minimumOutputs.length > 0, false);
}
