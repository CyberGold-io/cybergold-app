"use client";

import { useBasketPreview } from "@/app/hooks/protocol/useBasketPreview";

export function usePreviewIssueFromBasketExactIn(amountsIn: readonly bigint[], enabled = true) {
  return useBasketPreview<"issue-exact-in">({ mode: "issue-exact-in", maximumAmountsIn: amountsIn.map(String) },
    enabled && amountsIn.length > 0);
}
