import type { components } from "../contracts/backend/http";
import { diagnosticAttemptId, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { quoteResponseError } from "./quoteErrors.ts";

export type BasketMaxRequest = components["schemas"]["BasketMaxRequest"];
export type BasketMax = components["schemas"]["BasketMax"];

/** The Backend owns execution limits; the browser supplies only its wallet-funded upper budget. */
export async function fetchBasketMax(
  request: BasketMaxRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<BasketMax> {
  const attemptId = diagnosticAttemptId();
  const response = await fetchImpl("/api/quotes/basket-max", {
    method: "POST", headers: { "Content-Type": "application/json", ...(attemptId ? { "X-CyberGold-Attempt-Id": attemptId } : {}) },
    cache: "no-store", signal, body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await quoteResponseError(response);
    retainDiagnosticReferences(error, { attemptId });
    throw error;
  }
  return response.json();
}
