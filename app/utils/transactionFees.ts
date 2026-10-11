import type { components } from "../contracts/backend/http";

export type TransactionFees = components["schemas"]["TransactionFees"];

export function transactionFeesQuery(chainId: number, generation?: string | null) {
  return { queryKey: ["transaction-fees", chainId, generation] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTransactionFees(signal),
    staleTime: Infinity, retry: 1 };
}

export async function fetchTransactionFees(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<TransactionFees> {
  const response = await fetchImpl("/api/transaction/fees", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Transaction fee observations are temporarily unavailable.");
  return response.json();
}

export function transactionFeeValues(facts: TransactionFees) {
  return { maxFeePerGas: BigInt(facts.maxFeePerGas), maxPriorityFeePerGas: BigInt(facts.maxPriorityFeePerGas) };
}
