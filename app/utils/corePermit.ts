import type { Address } from "viem";
import type { components } from "../contracts/backend/http";

export type CorePermitContext = components["schemas"]["CorePermit"];

/** Fresh signing facts only. The App still chooses value/deadline and signs. */
export async function fetchCorePermit(owner: Address, fetchImpl: typeof fetch = fetch): Promise<CorePermitContext> {
  const response = await fetchImpl(`/api/account/core-permit?${new URLSearchParams({ owner })}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Core permit context is temporarily unavailable.");
  return response.json();
}

export function corePermitSigningFields(context: CorePermitContext, chainId: number, core: Address, helpers: Address) {
  // Keep the existing App's configured domain/spender, version and wallet
  // chain check. This operation replaces only the name/nonce observations.
  return { domain: { name: context.domain.name, version: "1", chainId, verifyingContract: core },
    spender: helpers, nonce: BigInt(context.nonce) };
}
