import type { Transport } from "viem";
import { createReceiptWaitClient } from "../../app/utils/receiptWait.ts";

// Historical comparison transport, retained only in test fixtures.
/** Move standard receipt and latest native-balance reads; preserve other library operations. */
export function withReceiptObservations(compatibility: Transport, fetchImpl: typeof fetch = fetch): Transport {
  return (options) => {
    const fallback = compatibility(options);
    const reader = createReceiptWaitClient({ chain: options.chain,
      pollingInterval: options.pollingInterval, timeout: fallback.config.timeout,
      retryCount: fallback.config.retryCount }, fetchImpl);
    return { ...fallback, request: ((request, requestOptions) => {
      const { method, params } = request;
      const receiptOperation = method === "eth_blockNumber" || method === "eth_getTransactionByHash"
        || method === "eth_getTransactionReceipt" || (method === "eth_getBlockByNumber"
          && Array.isArray(params) && params[1] === true && typeof params[0] === "string" && /^0x[0-9a-fA-F]+$/.test(params[0]));
      const latestBalance = method === "eth_getBalance" && Array.isArray(params) && params[1] === "latest";
      return receiptOperation || latestBalance ? reader.transport.request(request, requestOptions) : fallback.request(request, requestOptions);
    }) as typeof fallback.request };
  };
}

