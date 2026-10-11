import type { components } from "../contracts/backend/http";
import type { CoreTokenAmount, HelperFees } from "../types";

export type TokenPreviewRequest = components["schemas"]["TokenPreviewRequest"];
export type TokenPreview = components["schemas"]["TokenPreview"];
type IssueExactIn = { netCygldOut: bigint; fees: HelperFees; orderedCoreAssets: `0x${string}`[] };
type IssueExactOut = { fees: HelperFees; orderedCoreAssets: `0x${string}`[] };
type Redemption = { minimumAmountOut: bigint; projectedCoreOutputs: CoreTokenAmount[]; fees: HelperFees };
export type TokenPreviewResults = {
  "issue-token-exact-in": IssueExactIn; "issue-native-exact-in": IssueExactIn;
  "issue-token-exact-out": IssueExactOut; "issue-native-exact-out": IssueExactOut;
  "redeem-token-exact-in": Redemption; "redeem-native-exact-in": Redemption;
};

/** Keep the App's existing tuple shapes, opaque legs and lossless raw amounts. */
export function tokenPreviewResult(value: TokenPreview): TokenPreviewResults[TokenPreview["mode"]] {
  const fees = { protocolFeeCygld: BigInt(value.result.fees.protocolFeeCygld),
    helperFeeCygld: BigInt(value.result.fees.helperFeeCygld) };
  if (value.mode === "issue-token-exact-in" || value.mode === "issue-native-exact-in") {
    return { fees, netCygldOut: BigInt(value.result.netCygldOut), orderedCoreAssets: value.result.orderedCoreAssets as `0x${string}`[] };
  }
  if (value.mode === "issue-token-exact-out" || value.mode === "issue-native-exact-out") {
    return { fees, orderedCoreAssets: value.result.orderedCoreAssets as `0x${string}`[] };
  }
  if (value.mode === "redeem-token-exact-in" || value.mode === "redeem-native-exact-in") {
    return { fees, minimumAmountOut: BigInt(value.result.minimumAmountOut),
      projectedCoreOutputs: value.result.projectedCoreOutputs.map(row => ({
        kind: row.kind as CoreTokenAmount["kind"], token: row.token as `0x${string}`,
        id: BigInt(row.id), amount: BigInt(row.amount),
      })) };
  }
  throw new Error("Token previews are temporarily unavailable.");
}

export async function fetchTokenPreview<M extends TokenPreviewRequest["mode"]>(
  request: Extract<TokenPreviewRequest, { mode: M }>, signal?: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<TokenPreviewResults[M]> {
  const response = await fetchImpl("/api/quotes/token-preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("Token previews are temporarily unavailable.");
  return tokenPreviewResult(await response.json()) as TokenPreviewResults[M];
}
