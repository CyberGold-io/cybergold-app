import { encodeFunctionData, maxUint256, toHex, type Address, type Hex, type TypedData, type TypedDataDefinition, type WalletClient } from "viem";
import { erc20Abi } from "../contracts/erc20.ts";
import { HELPERS_EXECUTION_ABI } from "../contracts/cybergold-helpers/execution.ts";
import { assertWalletOnExpectedChain } from "./expectedChain.ts";
import type { HelpersExecutionOperation } from "./helpersExecutionGas.ts";

export type WalletAtomicStatus = "supported" | "ready" | "unsupported" | "unavailable";
export type WalletBatchCall = { to: Address; data: Hex; value?: bigint };
export type WalletTypedData = TypedDataDefinition<TypedData, string> & { account: Address };
export type WalletBatchTracker = { requestNext: (kind: "approval" | "signature" | "transaction", label: string) => void };
export type WalletBatchConfirmation = { transactionHash?: Hex };
export type WalletBatchSubmission = {
  kind: "wallet-batch" | "wallet-request-batch";
  id: string;
  transactionHashes?: readonly Hex[];
  wait: () => Promise<WalletBatchConfirmation>;
};

export class WalletBatchFailedError extends Error {
  readonly outcome: "failed" | "reverted";
  constructor(reverted: boolean) {
    super("The wallet batch failed.");
    this.outcome = reverted ? "reverted" : "failed";
    this.name = reverted ? "TransactionRevertedError" : "WalletBatchFailedError";
  }
}

/** Capability guarantees are per connected account/network, including forks. */
export async function walletAtomicStatus(client: Pick<WalletClient, "request">,
  owner: Address, chainId: number): Promise<WalletAtomicStatus> {
  try {
    const capabilities = await client.request({ method: "wallet_getCapabilities",
      params: [owner, [toHex(chainId)]] }, { retryCount: 0 });
    const status = (capabilities[toHex(chainId)] ?? capabilities["0x0"])?.atomic?.status;
    return status ?? "unsupported";
  } catch {
    // Discovery cannot prevent the ordinary sequential swap path.
    return "unavailable";
  }
}

export type WalletSwapBatch = {
  mode?: "atomic" | "requests";
  approvals: WalletBatchCall[];
  signTypedData?: (requests: readonly WalletTypedData[], tracker?: WalletBatchTracker) => Promise<Hex[]>;
  submit: (operation: HelpersExecutionOperation, args: readonly unknown[], value?: bigint,
    tracker?: WalletBatchTracker) => Promise<WalletBatchSubmission>;
};

export function collectWalletApproval(batch: WalletSwapBatch, token: Address, spender: Address, amount = maxUint256) {
  batch.approvals.push({ to: token, data: encodeFunctionData({ abi: erc20Abi,
    functionName: "approve", args: [spender, amount] }) });
}

/** The caller selects this only for an already-supported atomic account. */
export function createWalletSwapBatch(client: WalletClient, owner: Address, helpers: Address): WalletSwapBatch {
  const approvals: WalletBatchCall[] = [];
  return { mode: "atomic", approvals, async submit(operation, args, value) {
    // Preserve the same fresh chain check as ordinary Helpers writes.
    await assertWalletOnExpectedChain(client);
    const data = encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName: operation, args: args as never });
    const { id } = await client.sendCalls({ account: owner, chain: client.chain, forceAtomic: true,
      calls: [...approvals, { to: helpers, data, ...(value === undefined ? {} : { value }) }],
      experimental_fallback: false });
    // An opaque bundle ID is not a transaction hash. Once returned, never
    // resubmit this attempt through eth_sendTransaction on a later read failure.
    return { kind: "wallet-batch", id, async wait() {
      const result = await client.waitForCallsStatus({ id });
      if (result.status === "failure") {
        throw new WalletBatchFailedError(result.receipts?.some(receipt => receipt.status === "reverted") ?? false);
      }
      if (result.status !== "success") {
        const error = new Error("Wallet batch confirmation is unavailable.");
        error.name = "ReceiptUnavailableError";
        throw error;
      }
      return { transactionHash: result.receipts?.at(-1)?.transactionHash };
    } };
  } };
}
