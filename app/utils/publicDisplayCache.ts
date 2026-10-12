import { isAddress } from "viem";
import type { spendableToken } from "../config/tokens";
import type { TokenType } from "../types";

type DisplayStorage = Pick<Storage, "getItem" | "setItem">;
export const tokenDisplayCacheKey = (chainId: number) => `cybergold:display:tokens:v1:${chainId}`;
export const goldDisplayCacheKey = "cybergold:display:gold:v1";
export const fxDisplayCacheKey = "cybergold:display:fx:v1";

/** Selector metadata only. Never serialize the configuration, wallet or quote object. */
export function projectDisplayTokens(tokens: readonly TokenType[]): spendableToken[] {
  return tokens.flatMap<spendableToken>(token => {
    if (token.type === "basket") return [];
    const metadata = { id: token.id, symbol: token.symbol, name: token.name, decimals: token.decimals };
    return token.type === "native" ? [{ ...metadata, type: "native" }]
      : [{ ...metadata, type: "erc20", address: token.address, ...(token.chainId === undefined ? {} : { chainId: token.chainId }) }];
  });
}

export function parseDisplayTokens(value: unknown): spendableToken[] | undefined {
  if (!Array.isArray(value)) return;
  const tokens: spendableToken[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.symbol !== "string"
      || typeof row.name !== "string" || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 255) return;
    const metadata = { id: row.id, symbol: row.symbol, name: row.name, decimals: row.decimals };
    if (row.type === "native") tokens.push({ ...metadata, type: "native" });
    else if (row.type === "erc20" && typeof row.address === "string" && isAddress(row.address)) {
      tokens.push({ ...metadata, type: "erc20", address: row.address,
        ...(typeof row.chainId === "number" ? { chainId: row.chainId } : {}) });
    } else return;
  }
  return tokens;
}

function browserStorage(): DisplayStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

/** Storage is optional: restricted browsers continue their ordinary Backend read. */
export function readPublicDisplayCache<T>(key: string, parse: (value: unknown) => T | undefined,
  storage?: DisplayStorage): T | undefined {
  try {
    const raw = (storage ?? browserStorage())?.getItem(key);
    return raw ? parse(JSON.parse(raw)) : undefined;
  } catch { return undefined; }
}

export function writePublicDisplayCache(key: string, value: unknown, storage?: DisplayStorage): void {
  try { (storage ?? browserStorage())?.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

/** A stable external-store snapshot scoped to one hook, never to an SSR process. */
export function publicDisplaySnapshot<T>(key: string, parse: (value: unknown) => T | undefined, storage?: DisplayStorage) {
  let previous: string | null | undefined, value: T | undefined;
  return () => {
    try {
      const raw = (storage ?? browserStorage())?.getItem(key);
      if (raw !== previous) { value = raw ? parse(JSON.parse(raw)) : undefined; previous = raw; }
    } catch { previous = undefined; value = undefined; }
    return value;
  };
}
