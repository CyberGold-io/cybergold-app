import { encodeFunctionData, getTypesForEIP712Domain, serializeTypedData, toHex, type Address, type Hex, type WalletClient } from "viem";
import { HELPERS_EXECUTION_ABI } from "../contracts/cybergold-helpers/execution.ts";
import { assertWalletOnExpectedChain, EXPECTED_CHAIN_ID } from "./expectedChain.ts";
import type { EthereumProvider, EthereumRequestArgs } from "./ethereumProvider.ts";
import type { WalletAtomicStatus, WalletBatchSubmission, WalletReceiptLog, WalletSwapBatch } from "./walletBatch.ts";
import { createWalletSwapBatch, WalletBatchFailedError } from "./walletBatch.ts";

export type MetaMaskBatchRequest = { method: "eth_sendTransaction"; params: [{
  from: Address; to: Address; data: Hex; chainId: Hex; value?: Hex;
}] };
export type MetaMaskSignatureRequest = { method: "eth_signTypedData_v4"; params: [Address, string] };
type BatchProvider = { request: (args: { method: "metamask_batch"; params: (MetaMaskBatchRequest | MetaMaskSignatureRequest)[] }) => Promise<unknown> };

/** A failed signature group loses the SDK's partial results and must not be replayed. */
export class WalletSignatureBatchStoppedError extends Error {
  readonly completedSignatures: number;
  constructor(cause: unknown, completedSignatures: number) {
    super("The wallet signature batch stopped.", { cause });
    this.name = "WalletSignatureBatchStoppedError";
    this.completedSignatures = completedSignatures;
  }
}

/** An interrupted RPC batch can already have broadcast its first transactions. */
export class WalletRequestBatchStoppedError extends Error {
  readonly transactionHashes: readonly Hex[];
  readonly submission?: WalletBatchSubmission;
  constructor(cause: unknown, transactionHashes: readonly Hex[], submission?: WalletBatchSubmission) {
    super("The wallet request batch stopped.", { cause });
    this.name = "WalletRequestBatchStoppedError";
    this.transactionHashes = [...transactionHashes];
    this.submission = submission;
  }
}

export function reportWalletRequestBatchDiagnostic(event: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") console.info("[wallet-request-batch]", event);
}

type RequestBatchOptions = {
  getProvider: () => Promise<EthereumProvider | undefined>;
  waitReceipt: (hash: Hex) => Promise<{ status: "success" | "reverted"; logs?: readonly WalletReceiptLog[] }>;
  loadSDKProvider?: () => Promise<BatchProvider>;
  report?: (event: Record<string, unknown>) => void;
};

/** Classifies the optional transport; other wallets retain ordinary submission. */
export async function resolveSelectedMetaMaskExtension(provider: EthereumProvider,
  events: Pick<Window, "setTimeout" | "clearTimeout" | "addEventListener" | "removeEventListener" | "dispatchEvent"> = window
): Promise<EthereumProvider | undefined> {
  return new Promise(resolve => {
    const finish = (selected: EthereumProvider | undefined) => {
      events.clearTimeout(timeout);
      events.removeEventListener("eip6963:announceProvider", announced);
      resolve(selected);
    };
    const announced = (event: Event) => {
      const detail = (event as CustomEvent<{ provider: EthereumProvider; info: { rdns: string } }>).detail;
      if (detail?.provider && detail.info?.rdns === "io.metamask") {
        try {
          if (sdkUsesSelectedProvider(detail.provider, provider)) {
            // RainbowKit's configured MetaMask connector returns the SDK Proxy;
            // injected connectors return this raw announced provider directly.
            finish(detail.provider);
          }
        } catch {
          // DOM callback failures do not reject the surrounding Promise.
          // An unsupported wrapper stays an ordinary optional fallback.
          finish(undefined);
        }
      }
    };
    const timeout = events.setTimeout(() => finish(undefined), 500);
    events.addEventListener("eip6963:announceProvider", announced);
    events.dispatchEvent(new Event("eip6963:requestProvider"));
  });
}

const sdkSelectionMarker = Symbol("cybergold-sdk-selection");
function sdkUsesSelectedProvider(selected: EthereumProvider, sdk: object): boolean {
  // SDK 0.33.1's wrapper forwards ordinary property reads to its raw target.
  // A temporary marker binds that target without making any wallet/RPC call.
  const raw = selected as unknown as Record<symbol, unknown>;
  const wrapped = sdk as unknown as Record<symbol, unknown>;
  const marker = Symbol();
  try {
    raw[sdkSelectionMarker] = marker;
    return wrapped[sdkSelectionMarker] === marker;
  } finally {
    // Some in-page provider proxies ignore deletion; clear the value as well.
    raw[sdkSelectionMarker] = undefined;
    delete raw[sdkSelectionMarker];
  }
}

/** Prepare an optional MetaMask extension transport before any signing starts. */
export async function prepareWalletSwapBatch(client: WalletClient, owner: Address, helpers: Address,
  options: RequestBatchOptions & { chainId: number; atomicStatus: WalletAtomicStatus | undefined;
    resolveExtension?: (provider: EthereumProvider) => Promise<EthereumProvider | undefined> }): Promise<WalletSwapBatch | undefined> {
  // Existing supported atomic accounts retain their established path on every chain.
  const atomic = options.atomicStatus === "supported" ? createWalletSwapBatch(client, owner, helpers) : undefined;
  try {
    const selectedProvider = await options.getProvider();
    if (!selectedProvider?.isMetaMask) return atomic;
    const extension = await (options.resolveExtension ?? resolveSelectedMetaMaskExtension)(selectedProvider);
    if (!extension) return atomic;
    const provider = await (options.loadSDKProvider ?? installedSDKProvider)();
    if (!sdkUsesSelectedProvider(extension, provider)) return atomic;
    const sdk = createMetaMaskRequestBatch(client, owner, helpers, { ...options,
      getProvider: async () => extension, loadSDKProvider: async () => provider });
    return atomic ? { ...atomic, signTypedData: sdk.signTypedData } : sdk;
  } catch {
    // SDK availability is optional. No wallet request has started, so ordinary
    // approval/signing overlap remains available, including mobile wallets.
    (options.report ?? reportWalletRequestBatchDiagnostic)({ outcome: "setup-unavailable" });
    return atomic;
  }
}

let sdkProvider: Promise<BatchProvider> | undefined;
async function installedSDKProvider(): Promise<BatchProvider> {
  sdkProvider ??= (async () => {
    // SDK 0.33.1 wraps the EIP-6963 MetaMask extension. Raw extension RPC does
    // not implement metamask_batch. No connection/account-upgrade is requested.
    const { MetaMaskSDK } = await import("@metamask/sdk");
    const existing = (window as Window & { mmsdk?: InstanceType<typeof MetaMaskSDK> }).mmsdk;
    const sdk = existing?.isInitialized() ? existing : new MetaMaskSDK({
      dappMetadata: { name: "CyberGold", url: window.location.origin },
      extensionOnly: true, preferDesktop: true, headless: true,
      injectProvider: false, shouldShimWeb3: false, enableAnalytics: false,
      storage: { enabled: false }, checkInstallationImmediately: false,
    });
    await sdk.init();
    // The selected connector is the extension. Reuse its SDK wrapper even
    // when an existing SDK instance last used a remote mobile provider.
    const provider = sdk.extension;
    if (!provider) throw new Error("MetaMask SDK provider is unavailable.");
    return provider as unknown as BatchProvider;
  })();
  try {
    return await sdkProvider;
  } catch (error) {
    // A failed setup can be attempted again on the next user action. This
    // never retries any wallet batch or transaction that was already requested.
    sdkProvider = undefined;
    throw error;
  }
}

function requestBatchSubmission(hashes: readonly Hex[], waitReceipt: RequestBatchOptions["waitReceipt"]): WalletBatchSubmission {
  return { kind: "wallet-request-batch", id: hashes.at(-1)!, transactionHashes: [...hashes], async wait() {
    const receipts = await Promise.all(hashes.map(waitReceipt));
    if (receipts.some(receipt => receipt.status === "reverted")) throw new WalletBatchFailedError(true);
    const receipt = receipts.at(-1);
    return { transactionHash: hashes.at(-1), ...(receipt?.logs?.length ? { logs: receipt.logs } : {}) };
  } };
}

/** Prepared SDK request batching; all wallet prompts stay separate. */
export function createMetaMaskRequestBatch(client: WalletClient, owner: Address, helpers: Address,
  options: RequestBatchOptions): WalletSwapBatch {
  const approvals: WalletSwapBatch["approvals"] = [];
  const report = options.report ?? reportWalletRequestBatchDiagnostic;
  report({ mode: "requests", sdkVersion: "0.33.1", outcome: "enabled" });
  return { mode: "requests", approvals, async signTypedData(payloads, tracker) {
    await assertWalletOnExpectedChain(client);
    const selectedProvider = await options.getProvider();
    if (!selectedProvider?.isMetaMask) throw new Error("MetaMask provider is unavailable.");
    const provider = await (options.loadSDKProvider ?? installedSDKProvider)();
    const requests: MetaMaskSignatureRequest[] = payloads.map(payload => ({ method: "eth_signTypedData_v4", params: [
      payload.account, serializeTypedData({ ...payload, types: {
        EIP712Domain: getTypesForEIP712Domain({ domain: payload.domain }), ...payload.types,
      } }),
    ] }));
    const originalRequest = selectedProvider.request;
    let completed = 0;
    const observedRequest = async (request: EthereumRequestArgs) => {
      const isSignature = request.method === "eth_signTypedData_v4" && request.params === requests[completed]?.params;
      if (isSignature) tracker?.requestNext("signature", "Permit signature");
      const response = await originalRequest.call(selectedProvider, request);
      if (isSignature) completed += 1;
      return response;
    };
    selectedProvider.request = observedRequest;
    report({ method: "metamask_batch", phase: "signatures", calls: requests.length, outcome: "requested" });
    try {
      return await provider.request({ method: "metamask_batch", params: requests }) as Hex[];
    } catch (cause) {
      throw new WalletSignatureBatchStoppedError(cause, completed);
    } finally {
      if (selectedProvider.request === observedRequest) selectedProvider.request = originalRequest;
    }
  }, async submit(operation, args, value, tracker) {
    await assertWalletOnExpectedChain(client);
    const selectedProvider = await options.getProvider();
    if (!selectedProvider?.isMetaMask) throw new Error("MetaMask provider is unavailable.");
    const provider = await (options.loadSDKProvider ?? installedSDKProvider)();
    const calls = [...approvals, { to: helpers,
      data: encodeFunctionData({ abi: HELPERS_EXECUTION_ABI, functionName: operation, args: args as never }),
      ...(value === undefined ? {} : { value }) }];
    const requests: MetaMaskBatchRequest[] = calls.map(call => ({ method: "eth_sendTransaction", params: [{
      from: owner, to: call.to, data: call.data, chainId: toHex(EXPECTED_CHAIN_ID),
      ...(call.value === undefined ? {} : { value: toHex(call.value) }),
    }] }));
    const hashes: Hex[] = [];
    const originalRequest = selectedProvider.request;
    let current = 0;
    // Observe the SDK's actual underlying extension requests. Keep returned
    // hashes even when its final batch Promise rejects after partial broadcast.
    const observedRequest = async (request: EthereumRequestArgs) => {
      // SDK 0.33.1 preserves each supplied params array when calling the raw
      // extension. Associate this batch only; other panel actions stay usable.
      const isTransaction = request.method === "eth_sendTransaction" && request.params === requests[current]?.params;
      const index = current;
      if (isTransaction) {
        tracker?.requestNext(index < approvals.length ? "approval" : "transaction",
          index < approvals.length ? "Token approval" : "Transaction confirmation");
        report({ method: request.method, phase: index < approvals.length ? "approval" : "swap", outcome: "requested" });
      }
      const response = await originalRequest.call(selectedProvider, request);
      if (isTransaction) {
        current += 1;
        hashes.push(response as Hex);
        report({ method: request.method, outcome: "submitted", transactionHash: response });
      }
      return response;
    };
    selectedProvider.request = observedRequest;
    report({ method: "metamask_batch", sdkVersion: "0.33.1", calls: requests.length, atomic: false, outcome: "requested" });
    try {
      // Installed SDK 0.33.1 takes a FLAT array, unlike newer Connect examples.
      const result = await provider.request({ method: "metamask_batch", params: requests });
      const returnedHashes = result as Hex[];
      // Observations are used on failure; the SDK result is canonical on success.
      report({ method: "metamask_batch", outcome: "submitted", transactionHashes: returnedHashes });
      return requestBatchSubmission(returnedHashes, options.waitReceipt);
    } catch (cause) {
      report({ method: "metamask_batch", outcome: "stopped", transactionHashes: hashes });
      throw new WalletRequestBatchStoppedError(cause, hashes,
        hashes.length === requests.length ? requestBatchSubmission(hashes, options.waitReceipt) : undefined);
    } finally {
      if (selectedProvider.request === observedRequest) selectedProvider.request = originalRequest;
    }
  } };
}
