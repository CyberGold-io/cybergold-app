import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";

export type TransactionReceiptObservation = components["schemas"]["TransactionReceiptObservation"];

export async function fetchTransactionReceipt(hash: Hex, signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`/api/transaction/receipt?${new URLSearchParams({ hash })}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Transaction receipt is temporarily unavailable.");
  const observation: TransactionReceiptObservation = await response.json();
  const receipt = observation.receipt;
  if (receipt === null) return null;
  return { ...receipt, transactionHash: receipt.transactionHash as Hex,
    blockHash: receipt.blockHash as Hex, blockNumber: BigInt(receipt.blockNumber),
    logs: receipt.logs.map(row => ({ address: row.address as Address, data: row.data as Hex, topics: row.topics as Hex[] })) };
}
