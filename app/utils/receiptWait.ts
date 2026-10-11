import { createPublicClient, custom, toHex, type Chain, type PublicClient,
  type WaitForTransactionReceiptParameters } from "viem";
import type { components } from "../contracts/backend/http";
import { getHeadWatcher } from "./chainHead.ts";

/** Standard Viem formats, polls and detects replacement; only reads move. */
export function createReceiptWaitClient<C extends Chain | undefined = undefined>(
  configuration: { chain?: C; pollingInterval?: number; retryCount?: number; timeout?: number }, fetchImpl: typeof fetch = fetch,
) {
  async function read<Schema extends keyof components["schemas"]>(path: string) {
    const response = await fetchImpl(path, { cache: "no-store",
      signal: AbortSignal.timeout(configuration.timeout ?? 20_000) });
    if (!response.ok) throw new Error(path.startsWith("/api/account/") ? "Native balance is temporarily unavailable." : "Transaction confirmation observations are temporarily unavailable.");
    return response.json() as Promise<components["schemas"][Schema]>;
  }
  return createPublicClient({ chain: configuration.chain as C, pollingInterval: configuration.pollingInterval, transport: custom({
    async request({ method, params }) {
      switch (method) {
        case "eth_getBalance": {
          const value = await read<"NativeBalance">(`/api/account/native-balance?${new URLSearchParams({ holder: params[0], purpose: "display" })}`);
          return toHex(BigInt(value.balance));
        }
        case "eth_blockNumber": {
          const value = await getHeadWatcher(configuration.chain?.id ?? 0, fetchImpl)
            .read(AbortSignal.timeout(configuration.timeout ?? 20_000));
          return toHex(BigInt(value.blockNumber));
        }
        case "eth_getTransactionByHash": {
          const value = await read<"ReceiptWaitTransaction">(`/api/transaction/wait/transaction?${new URLSearchParams({ hash: params[0] })}`);
          return value.transaction;
        }
        case "eth_getTransactionReceipt": {
          const value = await read<"ReceiptWaitReceipt">(`/api/transaction/wait/receipt?${new URLSearchParams({ hash: params[0] })}`);
          return value.receipt;
        }
        case "eth_getBlockByNumber": {
          const value = await read<"ReceiptWaitBlock">(`/api/transaction/wait/block?${new URLSearchParams({ blockNumber: BigInt(params[0]).toString() })}`);
          return value.block;
        }
        default:
          throw new Error(`Receipt waiter requested unsupported operation ${method}.`);
      }
    },
  }, { retryCount: configuration.retryCount ?? 0 }) });
}

const clients = new WeakMap<PublicClient, ReturnType<typeof createReceiptWaitClient>>();


export function waitForAppTransactionReceipt(client: PublicClient, parameters: WaitForTransactionReceiptParameters) {
  let reader = clients.get(client);
  if (!reader) {
    reader = createReceiptWaitClient({ chain: client.chain, pollingInterval: client.pollingInterval,
      retryCount: client.transport.retryCount, timeout: client.transport.timeout });
    clients.set(client, reader);
  }
  return reader.waitForTransactionReceipt(parameters);
}
