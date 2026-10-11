import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";

export type GovernanceSafePrincipal = components["schemas"]["GovernanceSafePrincipal"];

export async function fetchGovernanceSafePrincipal(address: Address, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<GovernanceSafePrincipal> {
  const response = await fetchImpl(`/api/governance/safe-principal?address=${address}`, {
    signal, cache: "no-store",
  });
  if (!response.ok) throw new Error("Safe principal facts are temporarily unavailable.");
  return response.json();
}

export function safePrincipalCode(facts: GovernanceSafePrincipal): Hex {
  if (facts.code.status !== "success") throw new Error("The owner authority bytecode probe failed.");
  return facts.code.value as Hex;
}

export function safePrincipalOwners(facts: GovernanceSafePrincipal): Address[] {
  if (facts.owners.status !== "success") throw new Error("Safe owners are temporarily unavailable.");
  return facts.owners.value as Address[];
}

export function safePrincipalThreshold(facts: GovernanceSafePrincipal): bigint {
  if (facts.threshold.status !== "success") throw new Error("Safe threshold is temporarily unavailable.");
  return BigInt(facts.threshold.value);
}
