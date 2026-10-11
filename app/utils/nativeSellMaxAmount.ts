/** The fee budget already includes the fee cap's margin and priority fee. */
export function nativeSellMaxAmount(balance: bigint, gasBudget: bigint): bigint {
  return balance > gasBudget ? balance - gasBudget : 0n;
}
