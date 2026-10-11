import type { components } from "../contracts/backend/http";
import type { ProtocolBasketData } from "../types";
import { receiveProtocolModel, type ProtocolModel } from "./quoteModelStore.ts";
import type { IssuanceModel } from "./cygldSupply.ts";
import { knownQuoteError } from "./quoteErrors.ts";

export type ProtocolFacts = components["schemas"]["ProtocolFacts"];
export type FactRead<T> = { status: "success"; value: T } |
  { status: "failure"; error: "contract-read-failed" | "not-configured" };

export async function fetchProtocolFacts(signal?: AbortSignal, fetchImpl: typeof fetch = fetch, modelScope = ""): Promise<ProtocolFacts> {
  const response = await fetchImpl("/api/protocol/facts", { signal, cache: "no-store" });
  if (!response.ok) throw knownQuoteError(await response.json().catch(() => null)) ?? new Error("Protocol facts are temporarily unavailable.");
  const facts: ProtocolFacts = await response.json();
  if (!signal?.aborted) receiveProtocolModel(facts.basketModel, modelScope);
  return facts;
}

export function basketFromFacts(facts?: Pick<ProtocolFacts, "basket">): ProtocolBasketData {
  if (!facts) return undefined;
  const { assets, targetsPpm, goldRefGramsFp18, cygldPerUnitFp18, metadata } = facts.basket;
  if (assets.status !== "success" || targetsPpm.status !== "success" ||
      goldRefGramsFp18.status !== "success" || cygldPerUnitFp18.status !== "success") return undefined;
  if (assets.value.length === 0 || targetsPpm.value.length !== assets.value.length ||
      goldRefGramsFp18.value.length !== assets.value.length ||
      cygldPerUnitFp18.value.length !== assets.value.length || metadata.length !== assets.value.length) return undefined;
  const decimals: number[] = [], names: string[] = [], symbols: string[] = [];
  for (const row of metadata) {
    if (row.decimals.status !== "success" || row.name.status !== "success" || row.symbol.status !== "success") return undefined;
    decimals.push(row.decimals.value); names.push(row.name.value); symbols.push(row.symbol.value);
  }
  return [assets.value as `0x${string}`[], targetsPpm.value.map(BigInt), goldRefGramsFp18.value.map(BigInt),
    decimals, names, symbols, cygldPerUnitFp18.value.map(BigInt)];
}

export function bigintFact(read?: FactRead<string>): bigint | undefined {
  return read?.status === "success" ? BigInt(read.value) : undefined;
}

/** Capacity needs only issuance facts; redemption model reads remain independent. */
export function issuanceModelFromFacts(facts?: ProtocolFacts, fallback?: ProtocolModel): IssuanceModel | undefined {
  const capacity = facts?.issuanceCapacity;
  if (!facts || !capacity || capacity.totalSupply.status !== "success" ||
    capacity.maxTotalSupply.status !== "success" || capacity.effectiveCygldSupplyCap.status !== "success" ||
    facts.fees.issuancePpm.status !== "success" || facts.fees.helpersPpm.status !== "success") return fallback;
  const observed: IssuanceModel = {
    context: facts.context,
    state: {
      supply: capacity.totalSupply.value,
      maxSupply: capacity.maxTotalSupply.value,
      effectiveCap: capacity.effectiveCygldSupplyCap.value,
      issueFee: facts.fees.issuancePpm.value,
      helperFee: facts.fees.helpersPpm.value,
      assets: facts.basket.assets.status === "success" ? facts.basket.assets.value : undefined,
      weights: facts.basket.targetsPpm.status === "success" ? facts.basket.targetsPpm.value : undefined,
      conversions: facts.basket.cygldPerUnitFp18.status === "success" ? facts.basket.cygldPerUnitFp18.value : undefined,
    },
  };
  if (!fallback) return observed;
  const observedBlock = BigInt(observed.context.blockNumber), fallbackBlock = BigInt(fallback.context.blockNumber);
  return observedBlock > fallbackBlock || (observedBlock === fallbackBlock &&
    Date.parse(observed.context.observedAt) >= Date.parse(fallback.context.observedAt)) ? observed : fallback;
}
