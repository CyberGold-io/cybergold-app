import { formatUnits, type Address } from "viem";
import type { components } from "../contracts/backend/http";

export type RecoverySharePrecision = components["schemas"]["RecoverySharePrecision"];

export async function fetchRecoverySharePrecision(asset: Address, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<RecoverySharePrecision> {
  const response = await fetchImpl(`/api/protocol/recovery-share-precision?${new URLSearchParams({ asset })}`,
    { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Recovery-share precision is temporarily unavailable.");
  return response.json();
}

export function recoverySharePrecisionQuery(asset: Address, chain: number, core: Address | undefined, generation: string | null | undefined) {
  return { queryKey: ["recovery-share-precision", chain, core, asset, generation],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRecoverySharePrecision(asset, signal), staleTime: 15_000 };
}

export function formatRecoveryShareAmount(amount: bigint, shareDecimals?: number) {
  return shareDecimals === undefined ? `${amount} raw` : formatUnits(amount, shareDecimals);
}
