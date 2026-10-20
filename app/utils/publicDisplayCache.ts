import { isAddress } from "viem";
import type { spendableToken } from "../config/tokens";
import type { TokenType } from "../types";

type DisplayStorage = Pick<Storage, "getItem" | "setItem">;
export const tokenDisplayCacheKey = (chainId: number) => `cybergold:display:tokens:v1:${chainId}`;
export const goldDisplayCacheKey = "cybergold:display:gold:v1";
export const fxDisplayCacheKey = "cybergold:display:fx:v1";
export const tokenUsdDisplayCacheKey = (chainId: number) => `cybergold:display:token-usd:v1:${chainId}`;
export type DisplayTokenUsdPrices = Record<string, number>;

function displayPriceIdentity(token: spendableToken): string {
  return JSON.stringify([token.id, token.type,
    token.type === "erc20" ? token.address.toLowerCase() : "native", token.decimals]);
}

export function parseDisplayTokenUsdPrices(value: unknown): DisplayTokenUsdPrices | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entries = Object.entries(value);
  if (entries.some(([, price]) => typeof price !== "number" || !Number.isFinite(price) || price <= 0)) return;
  return Object.fromEntries(entries);
}

/** Persist valuations only; pool state, reference weights and quote inputs stay live. */
export function projectDisplayTokenUsdPrices(tokens: readonly TokenType[], prices: Record<string, number | undefined>): DisplayTokenUsdPrices {
  return Object.fromEntries(tokens.flatMap(token => {
    const price = prices[token.id];
    return token.type !== "basket" && price !== undefined && Number.isFinite(price) && price > 0
      ? [[displayPriceIdentity(token), price]] : [];
  }));
}

/** A cached approximation never becomes the live price observation used by other consumers. */
export function displayTokenUsdPrices(tokens: readonly TokenType[], live: Record<string, number | undefined>,
  cached: DisplayTokenUsdPrices | undefined): Record<string, number | undefined> {
  const prices = Object.fromEntries(tokens.map(token => [token.id,
    live[token.id] ?? (token.type === "basket" ? undefined : cached?.[displayPriceIdentity(token)])]));
  for (const token of tokens) {
    if (token.type !== "basket" || prices[token.id] !== undefined) continue;
    prices[token.id] = token.components.reduce<number | undefined>((sum, component) => {
      if (component.targetWeight === 0n) return sum;
      const price = prices[component.token.id];
      return sum === undefined || price === undefined ? undefined
        : sum + price * Number(component.targetWeight) / 1_000_000;
    }, 0);
  }
  return prices;
}

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
