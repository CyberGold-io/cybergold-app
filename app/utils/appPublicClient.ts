import { type Chain } from "viem";
import { createReceiptWaitClient } from "./receiptWait.ts";
import { withTransactionReverts } from "./transactionRevert.ts";
import { withEnsRecords } from "./ensRecords.ts";

/** App reads use fixed backend operations; connectors keep the wallet RPC. */
export function createAppPublicClient<C extends Chain>(configuration: { chain: C; pollingInterval?: number }, fetchImpl: typeof fetch = fetch) {
  return withEnsRecords(withTransactionReverts(createReceiptWaitClient({
    ...configuration, timeout: 20_000, retryCount: 0,
  }, fetchImpl), fetchImpl), fetchImpl);
}
