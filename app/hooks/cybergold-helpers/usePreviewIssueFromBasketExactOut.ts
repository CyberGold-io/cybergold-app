"use client";

import { useBasketPreview } from "@/app/hooks/protocol/useBasketPreview";

export function usePreviewIssueFromBasketExactOut(netCygldOut: bigint, enabled = true) {
  return useBasketPreview<"issue-exact-out">({ mode: "issue-exact-out", netCygldOut: String(netCygldOut) },
    enabled && netCygldOut > 0n);
}
