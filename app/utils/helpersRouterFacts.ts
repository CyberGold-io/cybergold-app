import { type Address, getAddress, isAddress, zeroAddress } from "viem";
import type { components } from "../contracts/backend/http";
import { bigintFact } from "./protocolFacts.ts";
import { knownQuoteError } from "./quoteErrors.ts";

export type HelpersRouterFacts = components["schemas"]["HelpersRouterFacts"];
export type HelpersRouterConfigState = {
  helperFeePpm?: bigint; permit2?: Address; wrappedNative?: Address;
  owner?: Address; paused?: boolean; approvedAdapters: Address[];
};

export async function fetchHelpersRouterFacts(signal?: AbortSignal, fetchImpl: typeof fetch = fetch, adapter?: Address): Promise<HelpersRouterFacts> {
  const path = "/api/governance/helpers-facts" + (adapter ? `?${new URLSearchParams({ adapter })}` : "");
  const response = await fetchImpl(path, { signal, cache: "no-store" });
  if (!response.ok) {
    const cause = knownQuoteError(await response.json().catch(() => null));
    if (cause) throw cause;
    throw new Error("Helpers configuration is temporarily unavailable.");
  }
  return response.json();
}

export async function fetchTokenPermitIssuanceInstalled(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl("/api/governance/helpers-facts?tokenPermitIssuance=true", { cache: "no-store" });
  if (!response.ok) throw new Error("Helpers configuration is temporarily unavailable.");
  const facts: HelpersRouterFacts = await response.json();
  const field = facts.configuration.tokenPermitIssuance;
  if (field?.status !== "success") throw new Error("Helpers token permit availability is temporarily unavailable.");
  return field.value;
}

export async function fetchMarketSwapInstalled(mode: "exact-in" | "exact-out", fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl("/api/governance/helpers-facts?marketSwap=true", { cache: "no-store" });
  if (!response.ok) throw new Error("Helpers configuration is temporarily unavailable.");
  const facts: HelpersRouterFacts = await response.json();
  const field = mode === "exact-in" ? facts.configuration.marketSwapExactInput : facts.configuration.marketSwapExactOutput;
  if (field?.status !== "success") throw new Error("Helpers market swap availability is temporarily unavailable.");
  return field.value;
}

export async function fetchBasketPermitIssuanceInstalled(mode: "exact-in" | "exact-out", fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl("/api/governance/helpers-facts?basketPermitIssuance=true", { cache: "no-store" });
  if (!response.ok) throw new Error("Helpers configuration is temporarily unavailable.");
  const facts: HelpersRouterFacts = await response.json();
  const field = mode === "exact-in" ? facts.configuration.basketPermitIssuanceExactIn : facts.configuration.basketPermitIssuanceExactOut;
  if (field?.status !== "success") throw new Error("Helpers basket permit availability is temporarily unavailable.");
  return field.value;
}

function address(value: string): Address | undefined {
  return isAddress(value) && value !== zeroAddress ? getAddress(value) : undefined;
}

export function helpersConfigFromFacts(facts?: HelpersRouterFacts): HelpersRouterConfigState | undefined {
  const fields = facts?.configuration;
  if (!fields) return undefined;
  return { helperFeePpm: bigintFact(fields.helperFeePpm),
    permit2: fields.permit2.status === "success" ? address(fields.permit2.value) : undefined,
    wrappedNative: fields.wrappedNative.status === "success" ? address(fields.wrappedNative.value) : undefined,
    owner: fields.owner.status === "success" ? address(fields.owner.value) : undefined,
    paused: fields.paused.status === "success" ? fields.paused.value : undefined,
    approvedAdapters: fields.approvedAdapters.status === "success"
      ? fields.approvedAdapters.value.map(address).filter((entry): entry is Address => entry !== undefined) : [],
  };
}

export function permit2FromFacts(facts: HelpersRouterFacts): Address {
  if (facts.configuration.permit2.status !== "success") throw new Error("Permit2 address is temporarily unavailable.");
  // Keep the zero value for the existing Permit2 flow's own configured-address check.
  return getAddress(facts.configuration.permit2.value);
}

export function adapterApprovalFromFacts(facts: HelpersRouterFacts, adapter?: Address): boolean | undefined {
  if (!adapter) return undefined;
  const field = facts.configuration.approvedAdapters;
  if (field.status !== "success") throw new Error("Adapter approval is temporarily unavailable.");
  // The pinned contract uses this EnumerableSet for approvedAdapters and
  // isAdapterApproved, so this membership preserves the on-chain result.
  return field.value.some(entry => entry.toLowerCase() === adapter.toLowerCase());
}

export function adapterCodePresentFromFacts(facts: HelpersRouterFacts): boolean {
  const field = facts.adapter?.codePresent;
  if (field?.status !== "success") throw new Error("Adapter code is temporarily unavailable.");
  return field.value;
}
