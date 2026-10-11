import type { TokenType } from "../types";
import { getAddress, type Address } from "viem";
import type { components } from "../contracts/backend/http";
import { type erc20Token } from "../config/tokens.ts";

export type TokenMetadata = components["schemas"]["TokenMetadata"];
export const importedTokenStorageKey = (chainId: number) => `cg:imported-tokens:${chainId}:v1`;
export const importedTokenId = (chainId: number, address: Address) => `${chainId}:${address.toLowerCase()}`;

export async function fetchTokenMetadata(token: Address, holder?: Address, signal?: AbortSignal, fetchImpl: typeof fetch = fetch,
  purpose?: "balance"): Promise<TokenMetadata> {
  const params = new URLSearchParams({ token });
  if (holder) params.set("holder", holder);
  if (purpose) params.set("purpose", purpose);
  const response = await fetchImpl(`/api/tokens/metadata?${params}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Token metadata is temporarily unavailable.");
  return response.json();
}

export function importedTokenFromMetadata(value: TokenMetadata, tokens: readonly TokenType[] = []): erc20Token | undefined {
  const address = getAddress(value.token.address);
  const configured = tokens.find((token): token is erc20Token => token.type === "erc20" && (token.chainId === undefined || token.chainId === value.token.chainId) && token.address.toLowerCase() === address.toLowerCase());
  if (configured) return configured;
  // Precision is required for amount entry. Failed reads remain unresolved.
  if (value.metadata.decimals.status !== "success") return undefined;
  return { id: importedTokenId(value.token.chainId, address), chainId: value.token.chainId,
    imported: true, type: "erc20", address, decimals: value.metadata.decimals.value,
    name: value.metadata.name.status === "success" ? value.metadata.name.value : address,
    symbol: value.metadata.symbol.status === "success" ? value.metadata.symbol.value : `${address.slice(0, 6)}…${address.slice(-4)}` };
}

/** Session storage retains observed metadata across locale navigation, scoped to this network. */
export function readImportedTokens(chainId: number, tokens: readonly TokenType[] = []): erc20Token[] {
  if (typeof window === "undefined") return [];
  try {
    const observations: TokenMetadata[] = JSON.parse(window.sessionStorage.getItem(importedTokenStorageKey(chainId)) ?? "[]");
    return observations.filter(value => value.token.chainId === chainId)
      .map(value => importedTokenFromMetadata(value, tokens)).filter((token): token is erc20Token => token?.imported === true);
  } catch { return []; }
}

export function rememberImportedToken(value: TokenMetadata) {
  if (typeof window === "undefined") return;
  const key = importedTokenStorageKey(value.token.chainId);
  let observations: TokenMetadata[];
  try { observations = JSON.parse(window.sessionStorage.getItem(key) ?? "[]"); }
  catch { observations = []; }
  const updated = observations.filter(entry => entry.token.address.toLowerCase() !== value.token.address.toLowerCase());
  updated.push(value);
  try { window.sessionStorage.setItem(key, JSON.stringify(updated)); } catch { /* Selection still works without storage. */ }
}
