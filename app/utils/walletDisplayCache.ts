import type { spendableToken } from "../config/tokens.ts";

/** A wallet's tab-local presentation cache is separate from the live read used by actions. */
export function walletDisplayCacheKey(chainId: number, holder: string | undefined, section: string) {
  return holder ? `cybergold:wallet-display:v1:${chainId}:${holder.toLowerCase()}:${section}` : undefined;
}

export type WalletDisplayBalances = Record<string, string>;
export const mergeWalletDisplayBalances = (cached: WalletDisplayBalances | undefined, observed: WalletDisplayBalances) => ({ ...cached, ...observed });

export function walletDisplayTokenIdentity(token: spendableToken) {
  return JSON.stringify([token.id, token.type, token.type === "erc20" ? token.address.toLowerCase() : "native", token.decimals]);
}

export function parseWalletDisplayBalances(value: unknown): WalletDisplayBalances | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entries = Object.entries(value);
  return entries.every(([, amount]) => typeof amount === "string" && /^\d+$/.test(amount))
    ? Object.fromEntries(entries) : undefined;
}

export function projectWalletDisplayBalances(tokens: readonly spendableToken[], balances: readonly { id: string; balance: bigint }[]): WalletDisplayBalances {
  return Object.fromEntries(tokens.flatMap(token => {
    const row = balances.find(balance => balance.id === token.id);
    return row ? [[walletDisplayTokenIdentity(token), row.balance.toString()]] : [];
  }));
}

export function walletDisplayBalance(token: spendableToken, balances: WalletDisplayBalances | undefined) {
  const value = balances?.[walletDisplayTokenIdentity(token)];
  return value === undefined ? undefined : BigInt(value);
}

export type WalletLiquidityDisplay = { positionCount: number; paxgAmount: string; cygldAmount: string };
export function parseWalletLiquidityDisplay(value: unknown): WalletLiquidityDisplay | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as WalletLiquidityDisplay;
  return Number.isInteger(row.positionCount) && row.positionCount >= 0 && typeof row.paxgAmount === "string"
    && typeof row.cygldAmount === "string" ? {
      positionCount: row.positionCount, paxgAmount: row.paxgAmount, cygldAmount: row.cygldAmount,
    } : undefined;
}

export type WalletRecoveryDisplay = {
  notConfigured: boolean;
  corePaused: boolean;
  rows: { shareId: string; assetLabel: string; balance: string; payout: string; fundOffer?: string; redeemLabel?: string; zeroPayout: boolean }[];
};

export function parseWalletRecoveryDisplay(value: unknown): WalletRecoveryDisplay | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as WalletRecoveryDisplay;
  if (typeof data.notConfigured !== "boolean" || typeof data.corePaused !== "boolean" || !Array.isArray(data.rows)) return;
  const rows: WalletRecoveryDisplay["rows"] = [];
  for (const row of data.rows) {
    if (!row || typeof row.shareId !== "string" || typeof row.assetLabel !== "string" || typeof row.balance !== "string"
      || typeof row.payout !== "string" || typeof row.zeroPayout !== "boolean"
      || (row.fundOffer !== undefined && typeof row.fundOffer !== "string")) return;
    rows.push({ shareId: row.shareId, assetLabel: row.assetLabel, balance: row.balance, payout: row.payout,
      zeroPayout: row.zeroPayout, ...(row.fundOffer === undefined ? {} : { fundOffer: row.fundOffer }),
      ...(typeof row.redeemLabel === "string" ? { redeemLabel: row.redeemLabel } : {}) });
  }
  return { notConfigured: data.notConfigured, corePaused: data.corePaused, rows };
}
