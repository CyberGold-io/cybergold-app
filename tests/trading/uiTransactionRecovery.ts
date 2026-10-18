import type { Hex } from "viem";
import { expect } from "@playwright/test";
import { fetchTransactionReceipt } from "../../app/utils/transactionReceipt.ts";
import type { ScenarioResult } from "./regression.ts";
import type { UiSwapObservation } from "./uiSwapObservation.ts";

const transactionHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

export function hasUiReceiptOutcome(result: Pick<ScenarioResult, "transactionHash" | "receipt">) {
  return transactionHash(result.transactionHash) && typeof result.receipt?.transactionHash === "string"
    && result.receipt.transactionHash.toLowerCase() === result.transactionHash.toLowerCase()
    && ["success", "reverted"].includes(String(result.receipt.status));
}

/** Finish only the original UI confirmation window; never start another one. */
export async function observeUiReceiptUntilDeadline(result: ScenarioResult, deadline: number, fetcher: typeof fetch = fetch) {
  if (hasUiReceiptOutcome(result)) return true;
  const remaining = Math.max(0, Math.floor(deadline - performance.now()));
  // No new read or zero-timeout poll may start after this original window:
  // Playwright treats zero as an unlimited deadline.
  if (!transactionHash(result.transactionHash) || remaining === 0) return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), remaining);
  try {
    await expect.poll(async () => {
      await recoverUiTransaction(result, undefined, undefined, fetcher, abort.signal);
      return hasUiReceiptOutcome(result);
    }, { timeout: remaining, intervals: [250, 500, 1000] }).toBe(true);
  } catch { /* The original failure and unknown outcome survive an exhausted read window. */ }
  finally { clearTimeout(timer); abort.abort(); }
  return hasUiReceiptOutcome(result);
}

/** Settlement of the original wallet request, not completion of its transaction. */
export function uiWalletRequestSettled(observation: UiSwapObservation | undefined, attemptId: string | undefined) {
  return Boolean(attemptId && observation?.attemptId === attemptId
    && (transactionHash(observation.transactionHash) || observation.walletRejected === true
      // The product reaches these stages before requesting authorization, or
      // after awaiting all authorizations (simulation). A previous completed
      // signature breadcrumb is not a still-pending native request.
      || observation.outcome === "failed" && ["quote", "balance", "network", "preparation", "simulation"].includes(observation.stage ?? "")));
}

/** Retain only the actual receipt identity/outcome, without changing the check. */
export function retainReceiptOutcome(result: Pick<ScenarioResult, "transactionHash" | "transactionDisposition" | "receipt">,
  receipt: NonNullable<Awaited<ReturnType<typeof fetchTransactionReceipt>>>) {
  result.transactionHash = receipt.transactionHash;
  result.receipt = { ...result.receipt, status: receipt.status,
    transactionHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: String(receipt.blockNumber) };
  result.transactionDisposition = "confirmed";
}

/** Recover evidence for the original UI trade after its display/assertion failed.
 * This makes at most one fixed receipt read, never another wallet request or transaction.
 * A mined revert is confirmed disposition with a reverted receipt; neither a
 * successful receipt nor native cancellation turns the failed UI check into pass.
 */
export async function recoverUiTransaction(result: ScenarioResult, attemptId: string | undefined,
  observation: UiSwapObservation | undefined, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const own = attemptId && observation?.attemptId === attemptId ? observation : undefined;
  const hash = transactionHash(result.transactionHash) ? result.transactionHash
    : transactionHash(own?.transactionHash) ? own.transactionHash : undefined;
  if (own) result.refs = { ...result.refs, attemptId: own.attemptId };
  if (!hash) {
    if (own?.walletRejected) {
      result.walletRequestErrorCode = 4001;
      result.transactionDisposition = "not-submitted";
    }
    return;
  }
  result.transactionHash = hash;
  if (signal?.aborted) return;
  try {
    const receipt = await fetchTransactionReceipt(hash, signal, fetcher);
    if (signal?.aborted) return;
    // An unrelated observation cannot establish this attempt's settlement.
    if (!receipt || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return;
    retainReceiptOutcome(result, receipt);
  } catch { /* An unavailable receipt preserves the original failure/unknown outcome. */ }
}
