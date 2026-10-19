import type { components } from "../contracts/backend/http";
import type { CoreTokenAmount, HelperFees } from "../types";
import { receiveProtocolModel } from "./quoteModelStore.ts";
import { quoteResponseError } from "./quoteErrors.ts";
import { diagnosticAttemptId, diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";

export type BasketPreviewRequest = components["schemas"]["BasketPreviewRequest"];
export type BasketPreview = components["schemas"]["BasketPreview"];
type NativeBasketPreviewResults = {
  "issue-exact-in": { netCygldOut: bigint; fees: HelperFees; amountsInExact: bigint[]; orderedCoreAssets: `0x${string}`[] };
  "issue-exact-out": { fees: HelperFees; amountsInExact: bigint[]; orderedCoreAssets: `0x${string}`[] };
  "redeem-exact-in": { projectedCoreOutputs: CoreTokenAmount[]; fees: HelperFees };
  "redeem-exact-out": { grossCygldIn: bigint; projectedCoreOutputs: CoreTokenAmount[]; fees: HelperFees };
};

export type BasketPreviewResults = { [M in keyof NativeBasketPreviewResults]: NativeBasketPreviewResults[M] & { basketPreviewObservation?: BasketPreview } };

function retainPreview<T extends object>(result: T, value: BasketPreview): T & { basketPreviewObservation?: BasketPreview } {
  try { return { ...result, basketPreviewObservation: structuredClone(value) }; } catch { return result; }
}
/** The exact preview retained with the flow's quote, including React Query copies. */
export function basketPreviewObservation(value: unknown): BasketPreview | undefined {
  try {
    return value && typeof value === "object" && "basketPreviewObservation" in value
      ? structuredClone(value.basketPreviewObservation as BasketPreview | undefined) : undefined;
  } catch { /* Optional observations cannot interrupt a basket trade. */ }
}

/** Restore the existing Helpers result shapes without floating point amounts. */
export function basketPreviewResult(value: BasketPreview): BasketPreviewResults[BasketPreview["mode"]] {
  const fees = { protocolFeeCygld: BigInt(value.result.fees.protocolFeeCygld),
    helperFeeCygld: BigInt(value.result.fees.helperFeeCygld) };
  if (value.mode === "issue-exact-in" || value.mode === "issue-exact-out") {
    const result = { fees, amountsInExact: value.result.amountsInExact.map(BigInt),
      orderedCoreAssets: value.result.orderedCoreAssets as `0x${string}`[] };
    return retainPreview(value.mode === "issue-exact-in" ? { ...result, netCygldOut: BigInt(value.result.netCygldOut) } : result, value);
  }
  const projectedCoreOutputs = value.result.projectedCoreOutputs.map(row => ({
    kind: row.kind as CoreTokenAmount["kind"], token: row.token as `0x${string}`,
    id: BigInt(row.id), amount: BigInt(row.amount),
  }));
  return retainPreview(value.mode === "redeem-exact-out"
    ? { fees, projectedCoreOutputs, grossCygldIn: BigInt(value.result.grossCygldIn) }
    : { fees, projectedCoreOutputs }, value);
}

export async function fetchBasketPreview<M extends BasketPreviewRequest["mode"]>(
  request: Extract<BasketPreviewRequest, { mode: M }>, signal?: AbortSignal, fetchImpl: typeof fetch = fetch, modelScope = "",
): Promise<BasketPreviewResults[M]> {
  const attemptId = diagnosticAttemptId();
  const response = await fetchImpl("/api/quotes/basket-preview", {
    method: "POST", headers: { "Content-Type": "application/json", ...(attemptId ? { "X-CyberGold-Attempt-Id": attemptId } : {}) }, cache: "no-store", signal,
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await quoteResponseError(response); retainDiagnosticReferences(error, { attemptId }); throw error;
  }
  // The generated request/response contract binds each mode to its tuple.
  const value: BasketPreview = await response.json();
  if (!signal?.aborted) receiveProtocolModel(value.basketModel, modelScope);
  const result = basketPreviewResult(value) as BasketPreviewResults[M];
  retainDiagnosticReferences(result, { ...diagnosticReferences(value), attemptId,
    requestId: response.headers.get("X-CyberGold-Request-Id") ?? undefined });
  return result;
}
