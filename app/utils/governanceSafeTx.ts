export type PendingSafeTxLike = {
  safeTxHash: string;
  nonce: number;
  isExecuted: boolean;
};

export function normalizeSafeTxHash(value: string): string {
  return value.toLowerCase();
}

export function localSafeExecutionStorageKey(chainId: number, safeAddress: string): string {
  return `cybergold:governance-safe-executions:${chainId}:${safeAddress.toLowerCase()}`;
}

export function localSafeNonceStorageKey(chainId: number, safeAddress: string): string {
  return `cybergold:governance-safe-nonce:${chainId}:${safeAddress.toLowerCase()}`;
}

export function parseStoredSafeNonce(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const nonce = Number(value);
  if (!Number.isFinite(nonce) || nonce < 0) return undefined;
  return nonce;
}

export function shouldResetLocalExecutionCache(
  previousNonce: number | undefined,
  currentNonce: number | undefined
): boolean {
  if (
    previousNonce === undefined ||
    currentNonce === undefined ||
    !Number.isFinite(previousNonce) ||
    !Number.isFinite(currentNonce)
  ) {
    return false;
  }
  return currentNonce < previousNonce;
}

export function buildExecutedSafeTxHashSet(
  sources: Array<Iterable<string> | undefined>
): Set<string> {
  const hashes = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const hash of source) {
      if (!hash) continue;
      hashes.add(normalizeSafeTxHash(hash));
    }
  }
  return hashes;
}

export function filterPendingSafeTransactions<T extends PendingSafeTxLike>(
  transactions: readonly T[],
  options: {
    liveSafeNonce?: number;
    executedSafeTxHashes?: ReadonlySet<string>;
  }
): T[] {
  const { liveSafeNonce, executedSafeTxHashes } = options;

  return transactions
    .filter((tx) => !tx.isExecuted)
    .filter((tx) => liveSafeNonce === undefined || tx.nonce >= liveSafeNonce)
    .filter((tx) => !executedSafeTxHashes?.has(normalizeSafeTxHash(tx.safeTxHash)))
    .sort((a, b) => b.nonce - a.nonce);
}
