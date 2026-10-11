import type { Address, Hex } from "viem";
import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";

export type PendingSafeTxQueueKind = "confirm" | "execute";

export type PendingSafeTxRow = {
  tx: SafeServicePendingTx;
  queueKind: PendingSafeTxQueueKind;
  confirmationsRequired: number;
  confirmationsCount: number;
  executableSignatureCount: number;
  hasEnoughExecutableSignatures: boolean;
  signedByOwners: Address[];
  signerConfirmed: boolean;
  isQueuedByNonce: boolean;
  isExecutableNow: boolean;
  hasNonceConflict: boolean;
  nextExecutableNonce?: number;
};

export function executableConfirmations(confirmations: Array<{ owner: Address; signature: Hex }>) {
  const byOwner = new Map<string, { owner: Address; signature: Hex }>();
  for (const confirmation of confirmations) {
    if (confirmation.signature.length !== 132) continue;
    byOwner.set(confirmation.owner.toLowerCase(), confirmation);
  }
  return [...byOwner.values()].sort((a, b) => a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()));
}

export function uniqueConfirmedOwners(confirmations: Array<{ owner: Address; signature: Hex }>) {
  const byOwner = new Map<string, Address>();
  for (const confirmation of confirmations) {
    byOwner.set(confirmation.owner.toLowerCase(), confirmation.owner);
  }
  return [...byOwner.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function sortAndConcatSignatures(confirmations: Array<{ owner: Address; signature: Hex }>) {
  const signatures = executableConfirmations(confirmations)
    .map((entry) => entry.signature.slice(2))
    .join("");
  return `0x${signatures}` as Hex;
}

export function countExecutableSignatures(confirmations: Array<{ owner: Address; signature: Hex }>) {
  return executableConfirmations(confirmations).length;
}

function timestampOrInfinity(value: string | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function sortPendingByNonceThenDate(a: SafeServicePendingTx, b: SafeServicePendingTx) {
  if (a.nonce !== b.nonce) return a.nonce - b.nonce;
  return timestampOrInfinity(a.submissionDate) - timestampOrInfinity(b.submissionDate);
}

export function buildPendingSafeTxRows(options: {
  transactions: readonly SafeServicePendingTx[];
  liveSafeThreshold?: number;
  connectedAddress?: Address;
  liveSafeNonce?: number;
}): PendingSafeTxRow[] {
  const connectedAddress = options.connectedAddress?.toLowerCase();
  const baseRows = options.transactions.map((tx) => {
    const confirmationsRequired = Math.max(options.liveSafeThreshold ?? 0, tx.confirmationsRequired ?? 0);
    const executableSignatureCount = countExecutableSignatures(tx.confirmations);
    const hasEnoughExecutableSignatures =
      confirmationsRequired > 0 && executableSignatureCount >= confirmationsRequired;
    const signedByOwners = uniqueConfirmedOwners(tx.confirmations);
    const signerConfirmed = connectedAddress
      ? tx.confirmations.some((confirmation) => confirmation.owner.toLowerCase() === connectedAddress)
      : false;

    return {
      tx,
      queueKind: hasEnoughExecutableSignatures ? "execute" : "confirm",
      confirmationsRequired,
      confirmationsCount: tx.confirmations.length,
      executableSignatureCount,
      hasEnoughExecutableSignatures,
      signedByOwners,
      signerConfirmed,
      isQueuedByNonce: false,
      isExecutableNow: false,
      hasNonceConflict: false,
      nextExecutableNonce: undefined,
    } satisfies PendingSafeTxRow;
  });

  const executableRows = baseRows.filter((row) => row.queueKind === "execute");
  const nonceCounts = new Map<number, number>();
  for (const row of executableRows) {
    nonceCounts.set(row.tx.nonce, (nonceCounts.get(row.tx.nonce) ?? 0) + 1);
  }

  const fallbackNextExecutableNonce =
    executableRows.length > 0
      ? executableRows.reduce((minimum, row) => Math.min(minimum, row.tx.nonce), Number.POSITIVE_INFINITY)
      : undefined;
  const nextExecutableNonce =
    options.liveSafeNonce ??
    (fallbackNextExecutableNonce === Number.POSITIVE_INFINITY ? undefined : fallbackNextExecutableNonce);

  return baseRows.map((row) => {
    if (row.queueKind !== "execute") return row;
    const isExecutableNow = nextExecutableNonce !== undefined && row.tx.nonce === nextExecutableNonce;
    const isQueuedByNonce = nextExecutableNonce !== undefined && row.tx.nonce > nextExecutableNonce;
    const hasNonceConflict = (nonceCounts.get(row.tx.nonce) ?? 0) > 1;
    return {
      ...row,
      isQueuedByNonce,
      isExecutableNow,
      hasNonceConflict,
      nextExecutableNonce,
    };
  });
}

export function splitPendingSafeTxRows(rows: readonly PendingSafeTxRow[]) {
  return {
    confirmRows: rows
      .filter((row) => row.queueKind === "confirm")
      .sort((a, b) => sortPendingByNonceThenDate(a.tx, b.tx)),
    executeRows: rows
      .filter((row) => row.queueKind === "execute")
      .sort((a, b) => sortPendingByNonceThenDate(a.tx, b.tx)),
  };
}
