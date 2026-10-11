import { hexToNumber, toHex, type Address } from "viem";
import type { components } from "../contracts/backend/http";

export type TransactionNonce = components["schemas"]["TransactionNonce"];

export function transactionNonceValue(snapshot: TransactionNonce): number {
  // Retain Viem's existing integer conversion, including its ordinary error
  // outside the wallet transaction API's safe number range.
  return hexToNumber(toHex(BigInt(snapshot.nonce)));
}

export async function fetchPendingTransactionNonce(owner: Address, fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl(`/api/account/transaction-nonce?${new URLSearchParams({ owner })}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Pending transaction nonce is temporarily unavailable.");
  return transactionNonceValue(await response.json());
}
