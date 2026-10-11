import type { BasketComponent } from "../types";
import { parseInputToBigInt } from "./numberParsing.ts";

type WalletBalanceEntry = {
  id: string;
  balance: bigint;
};

export function findWalletBalanceByTokenId(
  balances: readonly WalletBalanceEntry[]
): Record<string, bigint> {
  return Object.fromEntries(
    balances.map((balance) => [balance.id, balance.balance])
  ) as Record<string, bigint>;
}

export function isBasketComponentAmountOverWalletBalance(params: {
  component: BasketComponent;
  amountStr: string;
  walletBalanceByTokenId: Record<string, bigint>;
  locale?: string;
}): boolean {
  const { component, amountStr, walletBalanceByTokenId, locale } = params;

  const amountBigInt = parseInputToBigInt(amountStr, component.token.decimals, locale);
  if (amountBigInt === undefined) return false;

  const walletBalance = walletBalanceByTokenId[component.token.id];
  if (walletBalance === undefined) return false;
  return amountBigInt > walletBalance;
}
