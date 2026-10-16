import type { BrowserContext, Request } from "@playwright/test";

export const walletRpcMethods = ["eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_call", "eth_getCode", "net_version", "eth_chainId", "eth_getTransactionCount",
  "eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash"] as const;
type Method = typeof walletRpcMethods[number];
type Counts = { started: number; finished: number; failed: number; http: Record<string, number>; errors: Record<string, number> };
export type WalletRpcObservation = { elapsedMs: number; methods: Partial<Record<Method,
  Counts & { pending: number; oldestPendingMs?: number }>> };

/** Counts existing traffic during this observation window, not one transaction's RPCs.
 * Request objects, URLs, payloads, IDs, addresses and raw errors never cross this boundary.
 */
export function observeWalletRpc(context: BrowserContext, configuredEndpoint: string | undefined) {
  let endpoint: string;
  try { endpoint = new URL(configuredEndpoint!).href; }
  catch { return; } // Missing optional configuration does not change the native operation.
  const began = performance.now();
  let active = true, frozen: WalletRpcObservation | undefined;
  const pending = new Map<Request, { began: number; methods: Method[] }>();
  const counts = new Map<Method, Counts>();
  const removers: (() => void)[] = [];
  const row = (method: Method) => {
    let result = counts.get(method);
    if (!result) { result = { started: 0, finished: 0, failed: 0, http: {}, errors: {} }; counts.set(method, result); }
    return result;
  };
  const copy = (value: WalletRpcObservation): WalletRpcObservation => ({ elapsedMs: value.elapsedMs,
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
      for (const entry of pending.values()) for (const name of entry.methods) {
        const value = methods[name]!;
        value.pending++;
        value.oldestPendingMs = Math.max(value.oldestPendingMs ?? 0, Math.max(0, Math.round(now - entry.began)));
      }
      return { elapsedMs: Math.max(0, Math.round(now - began)), methods };
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
      pending.set(request, { began: performance.now(), methods: names });
      for (const name of names) row(name).started++;
    } catch { /* Optional observation never changes a request. */ }
  };
  const finished = (request: Request) => {
    try {
      if (!active) return;
      const entry = pending.get(request);
      if (!entry) return;
      pending.delete(request);
      for (const name of entry.methods) row(name).finished++;
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
      for (const name of entry.methods) row(name).failed++;
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
