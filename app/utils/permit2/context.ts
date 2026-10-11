import type { components } from "../../contracts/backend/http";

export type Permit2ContextRequest = components["schemas"]["Permit2ContextRequest"];
export type Permit2Context = components["schemas"]["Permit2Context"];

export async function fetchPermit2Context<M extends Permit2ContextRequest["mode"]>(
  request: Extract<Permit2ContextRequest, { mode: M }>, fetchImpl: typeof fetch = fetch,
): Promise<Extract<Permit2Context, { mode: M }>> {
  const response = await fetchImpl("/api/account/permit2", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("Permit2 observations are temporarily unavailable.");
  return response.json();
}
