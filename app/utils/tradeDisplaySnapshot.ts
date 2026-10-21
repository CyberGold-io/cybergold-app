import type { PersistedSwapFormState } from "./swapFormState";

type DisplayStorage = Pick<Storage, "getItem" | "setItem">;

/** A tab's rendered labels and estimates, never a quote or an executable token. */
export type TradeDisplaySnapshot = {
  intentKey: string;
  scopeKey: string;
  values: Record<string, string>;
  basketRows?: TradeBasketDisplayRow[];
};

/** Rendered basket rows only; they never supply a quote, balance or MAX calculation. */
export type TradeBasketDisplayRow = {
  side: "sell" | "buy";
  tokenId: string;
  symbol: string;
  address: string;
  weight: string;
  amount: string;
  equivalent: string;
  label: string;
  driver: boolean;
};

export const tradeDisplaySnapshotStorageKey = (chainId: number, locale: string) =>
  `cybergold:trade-display:v1:${chainId}:${locale}`;

/** A display from another amount or basket driver must not replace the current draft. */
export function tradeDisplayIntentKey(intent: PersistedSwapFormState): string {
  return JSON.stringify([
    intent.sellTokenId ?? "",
    intent.buyTokenId ?? "",
    intent.sellAmount ?? "",
    intent.driverToken?.toLowerCase() ?? "",
    intent.driverAmountStr ?? "",
  ]);
}

export function tradeDisplayScopeKey(scope: {
  chainId: number;
  locale: string;
  currency: string;
  goldUnit: string;
  priceDisplayMode: string;
}): string {
  return JSON.stringify([
    scope.chainId, scope.locale, scope.currency, scope.goldUnit, scope.priceDisplayMode,
  ]);
}

/** Also embedded in the pre-paint script, so keep this function self-contained. */
export function readStoredTradeDisplayScope(
  chainId: number,
  locale: string,
  storage?: Pick<Storage, "getItem">,
) {
  const scope = { chainId, locale, currency: "USD", goldUnit: "metric", priceDisplayMode: "fiat" };
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const currency = source?.getItem("display-currency");
    const goldUnit = source?.getItem("display-gold-unit");
    const priceDisplayMode = source?.getItem("display-price-mode");
    if (currency && ["USD", "EUR", "CHF"].includes(currency)) scope.currency = currency;
    if (goldUnit && ["imperial", "metric"].includes(goldUnit)) scope.goldUnit = goldUnit;
    if (priceDisplayMode && ["fiat", "gold"].includes(priceDisplayMode)) scope.priceDisplayMode = priceDisplayMode;
  } catch { /* optional browser preferences */ }
  return scope;
}

/** String-only projection suitable for assigning to textContent, not innerHTML. */
export function parseTradeDisplaySnapshot(value: unknown): TradeDisplaySnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (typeof record.intentKey !== "string" || typeof record.scopeKey !== "string"
    || !record.values || typeof record.values !== "object" || Array.isArray(record.values)) return;
  const entries = Object.entries(record.values);
  if (entries.some(([, text]) => typeof text !== "string")) return;
  let basketRows: TradeBasketDisplayRow[] | undefined;
  if (record.basketRows !== undefined) {
    if (!Array.isArray(record.basketRows)) return;
    basketRows = [];
    for (const row of record.basketRows) {
      if (!row || (row.side !== "sell" && row.side !== "buy") || typeof row.driver !== "boolean"
        || [row.tokenId, row.symbol, row.address, row.weight, row.amount, row.equivalent, row.label]
          .some(text => typeof text !== "string")) return;
      basketRows.push({ side: row.side, tokenId: row.tokenId, symbol: row.symbol, address: row.address,
        weight: row.weight, amount: row.amount, equivalent: row.equivalent, label: row.label, driver: row.driver });
    }
  }
  return {
    intentKey: record.intentKey,
    scopeKey: record.scopeKey,
    values: Object.fromEntries(entries) as Record<string, string>,
    ...(basketRows ? { basketRows } : {}),
  };
}

function tabStorage(): DisplayStorage | undefined {
  return typeof window === "undefined" ? undefined : window.sessionStorage;
}

export function readTradeDisplaySnapshot(
  key: string,
  intentKey: string,
  scopeKey: string,
  storage?: DisplayStorage,
): TradeDisplaySnapshot | undefined {
  try {
    const raw = (storage ?? tabStorage())?.getItem(key);
    const snapshot = raw ? parseTradeDisplaySnapshot(JSON.parse(raw)) : undefined;
    return snapshot?.intentKey === intentKey && snapshot.scopeKey === scopeKey ? snapshot : undefined;
  } catch { return undefined; }
}

/** Storage is optional; unavailable storage cannot interrupt the ordinary form. */
export function writeTradeDisplaySnapshot(
  key: string,
  value: TradeDisplaySnapshot,
  storage?: DisplayStorage,
): void {
  try {
    const snapshot = parseTradeDisplaySnapshot(value);
    if (snapshot) (storage ?? tabStorage())?.setItem(key, JSON.stringify(snapshot));
  } catch { /* best effort */ }
}
