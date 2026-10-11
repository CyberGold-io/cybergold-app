import type { Address } from "viem";
import type { components } from "../contracts/backend/http";

export type CoreRecoveryAssets = components["schemas"]["CoreRecoveryAssets"];

export async function fetchCoreRecoveryAssets(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<CoreRecoveryAssets> {
  const response = await fetchImpl("/api/protocol/recovery-assets", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Core recovery assets are temporarily unavailable.");
  return response.json();
}

export function attachedRecoveryAssets(facts: CoreRecoveryAssets): readonly Address[] {
  return facts.assets as Address[];
}
