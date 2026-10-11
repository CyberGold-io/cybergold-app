import { getAddress, type Address } from "viem";
import type { components } from "../contracts/backend/http";
import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";
import { isSafeRejectionTransaction } from "./governanceSafeContracts.ts";

export function isGovernanceTargetMissingCode(params: {
  tx: SafeServicePendingTx;
  hasCode?: boolean;
  safeAddress?: Address;
}) {
  const { tx, hasCode, safeAddress } = params;
  if (hasCode !== false) return false;
  if (tx.data === "0x") return false;
  if (safeAddress && isSafeRejectionTransaction(tx, safeAddress)) return false;
  return true;
}

/** Retain the proposal classifier's all-or-error destination observation. */
export async function fetchGovernanceTargetCodes(
  addresses: readonly string[], signal?: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<Map<string, boolean>> {
  return new Map(await Promise.all(addresses.map(async address => {
    const query = new URLSearchParams({ address: getAddress(address) });
    const response = await fetchImpl(`/api/governance/target-code?${query}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Proposal target code is temporarily unavailable.");
    const value: components["schemas"]["GovernanceTargetCode"] = await response.json();
    return [address, value.hasCode] as const;
  })));
}
