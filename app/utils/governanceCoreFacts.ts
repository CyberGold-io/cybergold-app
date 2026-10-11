import { type Address, getAddress, isAddress, type Hex } from "viem";
import type { components } from "../contracts/backend/http";
import { bigintFact } from "./protocolFacts.ts";

export type GovernanceCoreFacts = components["schemas"]["GovernanceCoreFacts"];
export type CoreControllerConfigState = {
  treasury?: Address; basketConfigHash?: Hex; issuanceFeePpm?: bigint;
  redemptionFeePpm?: bigint; maxFeePpm?: bigint; maxTotalSupply?: bigint; totalSupply?: bigint;
};

export async function fetchGovernanceCoreFacts(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<GovernanceCoreFacts> {
  const response = await fetchImpl("/api/governance/core-facts", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Core governance facts are temporarily unavailable.");
  return response.json();
}

export function coreSafeWalletFromFacts(facts: GovernanceCoreFacts): Address {
  const field = facts.configuration.safeWallet;
  if (field?.status !== "success") throw new Error("Core Safe authority is temporarily unavailable.");
  // The existing authority resolver handles the configured zero address.
  return getAddress(field.value);
}

export function coreConfigFromFacts(facts?: GovernanceCoreFacts): CoreControllerConfigState | undefined {
  const fields = facts?.configuration;
  // Preserve the current controller's required treasury read and optional
  // other fields. A failed amount is unavailable rather than zero.
  if (!fields || fields.treasury.status !== "success") return undefined;
  const address = fields.treasury.value;
  const treasury = isAddress(address) && address !== "0x0000000000000000000000000000000000000000"
    ? getAddress(address) : undefined;
  return { treasury,
    basketConfigHash: fields.basketConfigHash.status === "success" ? fields.basketConfigHash.value as Hex : undefined,
    issuanceFeePpm: bigintFact(fields.issuanceFeePpm), redemptionFeePpm: bigintFact(fields.redemptionFeePpm),
    maxFeePpm: bigintFact(fields.maxFeePpm), maxTotalSupply: bigintFact(fields.maxTotalSupply), totalSupply: bigintFact(fields.totalSupply) };
}
