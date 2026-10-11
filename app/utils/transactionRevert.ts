import { decodeErrorResult, parseAbi, type Client, type Transport, type Chain, type Hex, type WaitForTransactionReceiptParameters } from "viem";
import { waitForTransactionReceipt } from "viem/actions";
import type { components } from "../contracts/backend/http";

const errors = parseAbi(["error Error(string)", "error Panic(uint256)"]);
function reason(data: string | null) {
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: errors, data: data as Hex });
      return decoded.errorName === "Error" ? String(decoded.args[0]) : `Transaction reverted (Panic 0x${BigInt(decoded.args[0]).toString(16)}).`;
    } catch { /* Unknown/custom return bytes retain a plain failure message. */ }
  }
  return "Transaction reverted (unknown reason).";
}

/** Supported Wagmi action override; standard Viem owns waits and replacements. */
export function withTransactionReverts<T extends Transport, C extends Chain | undefined>(client: Client<T, C>, fetchImpl: typeof fetch = fetch) {
  return client.extend(() => ({
    waitForTransactionReceipt: async (parameters: WaitForTransactionReceiptParameters) => {
      const receipt = await waitForTransactionReceipt(client, parameters);
      if (receipt.status === "reverted") {
        const response = await fetchImpl(`/api/transaction/revert?${new URLSearchParams({ hash: receipt.transactionHash })}`, {
          cache: "no-store", signal: AbortSignal.timeout(client.transport.timeout ?? 20_000),
        });
        if (!response.ok) throw new Error("Transaction revert observations are temporarily unavailable.");
        const observation = await response.json() as components["schemas"]["TransactionRevert"];
        throw new Error(reason(observation.data));
      }
      return receipt;
    },
  }));
}
