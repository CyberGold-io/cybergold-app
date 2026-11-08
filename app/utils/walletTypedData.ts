import type { Hex } from "viem";
import type { WalletBatchTracker, WalletSwapBatch, WalletTypedData } from "./walletBatch.ts";

/** Eligible SDK transports own the sequence in one call; other wallets retain ordinary signing. */
export async function signWalletTypedDataGroup(requests: readonly WalletTypedData[],
  signTypedData: (request: WalletTypedData) => Promise<Hex>, batch?: WalletSwapBatch, tracker?: WalletBatchTracker): Promise<Hex[]> {
  if (!requests.length) return [];
  if (batch?.signTypedData) return batch.signTypedData(requests, tracker);
  const signatures: Hex[] = [];
  for (const request of requests) {
    tracker?.requestNext("signature", "Permit signature");
    signatures.push(await signTypedData(request));
    try { void Promise.resolve(tracker?.signatureFulfilled?.()).catch(() => {}); }
    catch { /* Optional observation cannot replace the fulfilled signing result. */ }
  }
  return signatures;
}
