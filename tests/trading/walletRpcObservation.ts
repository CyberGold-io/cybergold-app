import type { BrowserContext, Request } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";

export const walletRpcMethods = ["eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_call", "eth_getCode", "net_version", "eth_chainId", "eth_getTransactionCount",
  "eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash"] as const;
type Method = typeof walletRpcMethods[number];
type Counts = { started: number; finished: number; failed: number; http: Record<string, number>; errors: Record<string, number>;
  firstStartedMs?: number; lastFinishedMs?: number; lastFailedMs?: number };
type TargetCategory = "core" | "helpers" | "permit2" | "multicall" | "token" | "other";
type BlockTagCategory = "omitted" | "latest" | "pending" | "earliest" | "safe" | "finalized" | "number" | "hash" | "other";
export type WalletRpcTargets = Partial<Record<"core" | "helpers" | "permit2" | "multicall", string | null>> & { tokens?: readonly string[] };
export type PendingEthCall = { transportOrdinal: number; batchIndex: number; batchSize: number; selector?: string;
  targetCategory: TargetCategory; blockTagCategory: BlockTagCategory; requireCanonical?: boolean;
  stateOverridePresent: boolean; startedMs: number; pendingMs: number };
export type WalletRpcObservation = { elapsedMs: number; pendingHttpRequests: number;
  pendingEthCalls: PendingEthCall[]; pendingEthCallsTruncated: boolean; methods: Partial<Record<Method,
  Counts & { pending: number; oldestPendingMs?: number }>> };
const pendingCallLimit = 8;

/** Use existing public observations only; a missing mapping remains unknown. */
export function walletRpcTargets(configuration: ProtocolConfiguration, permit2?: string): WalletRpcTargets {
  try {
    return { core: configuration.contracts.core, helpers: configuration.contracts.helpers, permit2,
      tokens: configuration.tokens.flatMap(token => token.type === "erc20" ? [token.address] : []) };
  } catch { return {}; } // Optional categorization cannot prevent a wallet operation.
}

function callDescriptor(call: unknown, targets: WalletRpcTargets) {
  const result: Pick<PendingEthCall, "selector" | "targetCategory" | "blockTagCategory" | "requireCanonical" | "stateOverridePresent"> = {
    targetCategory: "other", blockTagCategory: "omitted", stateOverridePresent: false,
  };
  try {
    const params = call && typeof call === "object" ? (call as { params?: unknown }).params : undefined;
    if (!Array.isArray(params)) return result;
    const override = params[2];
    result.stateOverridePresent = override !== null && typeof override === "object" && !Array.isArray(override);
    const block = params[1];
    if (block !== undefined) result.blockTagCategory = "other";
    if (typeof block === "string") {
      if (["latest", "pending", "earliest", "safe", "finalized"].includes(block)) result.blockTagCategory = block as BlockTagCategory;
      else if (/^0x[0-9a-fA-F]{64}$/.test(block)) result.blockTagCategory = "hash";
      else if (/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(block)) result.blockTagCategory = "number";
    } else if (block && typeof block === "object") {
      const { blockHash, blockNumber, requireCanonical } = block as { blockHash?: unknown; blockNumber?: unknown; requireCanonical?: unknown };
      if (typeof blockHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(blockHash)) result.blockTagCategory = "hash";
      else if (typeof blockNumber === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(blockNumber)) result.blockTagCategory = "number";
      if (typeof requireCanonical === "boolean") result.requireCanonical = requireCanonical;
    }
    const transaction = params[0];
    if (transaction && typeof transaction === "object") {
      const { data, input, to } = transaction as { data?: unknown; input?: unknown; to?: unknown };
      const calldata = data === undefined ? input : data;
      const prefix = typeof calldata === "string" ? calldata.slice(0, 10) : "";
      if (/^0x[0-9a-fA-F]{8}$/.test(prefix)) result.selector = prefix.toLowerCase();
      if (typeof to === "string" && /^0x[0-9a-fA-F]{40}$/.test(to)) {
        const address = to.toLowerCase();
        for (const category of ["core", "helpers", "permit2", "multicall"] as const) {
          if (typeof targets[category] === "string" && targets[category]!.toLowerCase() === address) {
            result.targetCategory = category; break;
          }
        }
        if (result.targetCategory === "other" && targets.tokens?.some(token => token.toLowerCase() === address)) result.targetCategory = "token";
      }
    }
  } catch { /* Optional malformed metadata does not affect method accounting. */ }
  return result;
}

/** Counts existing traffic during this observation window, not one transaction's RPCs.
 * Request objects, URLs, payloads, IDs, addresses and raw errors never cross this boundary.
 */
export function observeWalletRpc(context: BrowserContext, configuredEndpoint: string | undefined, targets: WalletRpcTargets = {}) {
  let endpoint: string;
  try { endpoint = new URL(configuredEndpoint!).href; }
  catch { return; } // Missing optional configuration does not change the native operation.
  const began = performance.now();
  let active = true, frozen: WalletRpcObservation | undefined;
  let transportOrdinal = 0;
  const pending = new Map<Request, { began: number; methods: Method[]; calls: Omit<PendingEthCall, "pendingMs">[] }>();
  const counts = new Map<Method, Counts>();
  const removers: (() => void)[] = [];
  const row = (method: Method) => {
    let result = counts.get(method);
    if (!result) { result = { started: 0, finished: 0, failed: 0, http: {}, errors: {} }; counts.set(method, result); }
    return result;
  };
  const copy = (value: WalletRpcObservation): WalletRpcObservation => ({ elapsedMs: value.elapsedMs,
    pendingHttpRequests: value.pendingHttpRequests, pendingEthCallsTruncated: value.pendingEthCallsTruncated,
    pendingEthCalls: value.pendingEthCalls.map(call => ({ ...call })),
    methods: Object.fromEntries(Object.entries(value.methods).map(([name, current]) =>
      [name, { ...current, http: { ...current!.http }, errors: { ...current!.errors } }])) });
  const snapshot = (): WalletRpcObservation | undefined => {
    try {
      if (!active) return frozen ? copy(frozen) : undefined;
      const now = performance.now();
      const methods: WalletRpcObservation["methods"] = {};
      for (const name of walletRpcMethods) {
        const value = counts.get(name);
        if (!value) continue;
        methods[name] = { ...value, http: { ...value.http }, errors: { ...value.errors }, pending: 0 };
      }
      const pendingEthCalls: PendingEthCall[] = [];
      let pendingEthCallCount = 0;
      for (const entry of pending.values()) {
        const pendingMs = Math.max(0, Math.round(now - entry.began));
        for (const name of entry.methods) {
          const value = methods[name]!;
          value.pending++;
          value.oldestPendingMs = Math.max(value.oldestPendingMs ?? 0, pendingMs);
          if (name === "eth_call") pendingEthCallCount++;
        }
        for (const call of entry.calls) if (pendingEthCalls.length < pendingCallLimit) pendingEthCalls.push({ ...call, pendingMs });
      }
      return { elapsedMs: Math.max(0, Math.round(now - began)), pendingHttpRequests: pending.size,
        pendingEthCalls, pendingEthCallsTruncated: pendingEthCallCount > pendingEthCalls.length, methods };
    } catch { /* Optional measurement cannot replace a wallet outcome. */ }
  };
  const stop = () => {
    if (!active) return;
    frozen = snapshot();
    active = false;
    for (const remove of removers.splice(0).reverse()) {
      try { remove(); } catch { /* Continue detaching the other owned listeners. */ }
    }
    pending.clear();
  };
  const started = (request: Request) => {
    try {
      if (!active || new URL(request.url()).href !== endpoint) return;
      const body: unknown = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      const names = calls.map(call => call && typeof call === "object" ? (call as { method?: unknown }).method : undefined)
        .filter((name): name is Method => typeof name === "string" && (walletRpcMethods as readonly string[]).includes(name));
      if (!names.length) return;
      const started = performance.now(), startedMs = Math.max(0, Math.round(started - began));
      const ordinal = ++transportOrdinal;
      const descriptors: Omit<PendingEthCall, "pendingMs">[] = [];
      for (const [batchIndex, call] of calls.entries()) {
        if (descriptors.length >= pendingCallLimit) break;
        if (call && typeof call === "object" && (call as { method?: unknown }).method === "eth_call") {
          descriptors.push({ ...callDescriptor(call, targets), transportOrdinal: ordinal, batchIndex,
            batchSize: calls.length, startedMs });
        }
      }
      pending.set(request, { began: started, methods: names, calls: descriptors });
      for (const name of names) { const value = row(name); value.started++; value.firstStartedMs ??= startedMs; }
    } catch { /* Optional observation never changes a request. */ }
  };
  const finished = (request: Request) => {
    try {
      if (!active) return;
      const entry = pending.get(request);
      if (!entry) return;
      pending.delete(request);
      const settledMs = Math.max(0, Math.round(performance.now() - began));
      for (const name of entry.methods) { const value = row(name); value.finished++; value.lastFinishedMs = settledMs; }
      void request.response().then(response => {
        if (!active || !response) return;
        const status = response.status();
        if (!Number.isInteger(status) || status < 100 || status > 599) return;
        for (const name of entry.methods) {
          const http = row(name).http;
          http[String(status)] = (http[String(status)] ?? 0) + 1;
        }
      }).catch(() => {});
    } catch { /* Optional observation never changes a request. */ }
  };
  const failed = (request: Request) => {
    try {
      if (!active) return;
      const entry = pending.get(request);
      if (!entry) return;
      pending.delete(request);
      const settledMs = Math.max(0, Math.round(performance.now() - began));
      for (const name of entry.methods) { const value = row(name); value.failed++; value.lastFailedMs = settledMs; }
      const text = request.failure()?.errorText ?? "";
      const errorClass = /TIMED_OUT|TIMEOUT/.test(text) ? "timeout"
        : /ABORTED|CANCELLED/.test(text) ? "aborted" : /CONNECTION|NAME_NOT_RESOLVED/.test(text) ? "connection" : "network";
      for (const name of entry.methods) {
        const current = row(name);
        current.errors[errorClass] = (current.errors[errorClass] ?? 0) + 1;
      }
    } catch { /* Optional observation never changes a request. */ }
  };
  const attach = (add: () => void, remove: () => void) => { removers.push(remove); add(); };
  try {
    attach(() => context.on("request", started), () => context.off("request", started));
    attach(() => context.on("requestfinished", finished), () => context.off("requestfinished", finished));
    attach(() => context.on("requestfailed", failed), () => context.off("requestfailed", failed));
  } catch { stop(); return; } // Roll back even a partial optional registration.
  return { snapshot, stop };
}
