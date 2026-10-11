import { getAddress, type Address } from "viem";
import type { components } from "../contracts/backend/http";

export type GovernanceAuthorityFacts = components["schemas"]["GovernanceAuthority"];
export type AuthoritySurface = GovernanceAuthorityFacts["surface"];

export async function fetchGovernanceAuthorityFacts(surface: AuthoritySurface, account?: Address,
  signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<GovernanceAuthorityFacts> {
  const query = new URLSearchParams({ surface });
  if (account) query.set("account", account);
  const response = await fetchImpl(`/api/governance/authority?${query}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Governance authority observations are temporarily unavailable.");
  return response.json();
}

export function governanceSafeWallet(facts: GovernanceAuthorityFacts): Address {
  if (facts.safeWallet.status !== "success") throw new Error("Governance Safe authority is temporarily unavailable.");
  return getAddress(facts.safeWallet.value);
}

export function governanceAuthorityFlag(facts: GovernanceAuthorityFacts | undefined,
  field: "paused" | "accountCanPause" | "accountCanUnpause" | "safeCanUnpause"): boolean | undefined {
  const value = facts?.[field];
  return value?.status === "success" ? value.value : undefined;
}
