import type { components } from "../contracts/backend/http";

export type ClientDiagnostic = components["schemas"]["ClientDiagnostic"];
export type DiagnosticContext = Pick<ClientDiagnostic, "direction" | "route" | "inputMode" | "chainId" | "assetCount">;
type Reporter = (event: ClientDiagnostic) => void;

function newAttemptId() {
  try { return crypto.randomUUID(); } catch { return undefined; }
}

/** No queue, retry, cookies or persistent browser identifier. Never await telemetry. */
export function reportClientDiagnostic(event: ClientDiagnostic, fetcher: typeof fetch = fetch): void {
  try {
    void fetcher("/api/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event), credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch { /* A missing browser API or failed collector cannot interrupt a swap. */ }
}

export function diagnosticReason(error: unknown): ClientDiagnostic["reason"] {
  return diagnosticFailure(error).reason;
}

/** Project only a numeric code and four-byte structured revert selector. */
export function diagnosticFailure(error: unknown): Pick<ClientDiagnostic, "reason" | "errorCode" | "errorSelector"> {
  // Error text and generic `data` can contain signatures, URLs and calldata.
  const seen = new Set<unknown>();
  let errorCode: number | undefined;
  let errorSelector: string | undefined;
  let rejected = false;
  let wrongChain = false;
  let reverted = false;
  let rpc = false;
  let value = error;
  while (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    const current = value as { code?: unknown; name?: unknown; raw?: unknown; cause?: unknown };
    // Prefer the underlying provider code over wrapper codes such as Viem's -1.
    if (typeof current.code === "number" && Number.isSafeInteger(current.code)) {
      errorCode = current.code;
    }
    if (current.name === "ContractFunctionRevertedError" && typeof current.raw === "string"
      && /^0x(?:[0-9a-fA-F]{2}){4,}$/.test(current.raw)) {
      errorSelector ??= current.raw.slice(0, 10).toLowerCase();
    }
    rejected ||= current.code === 4001 || current.name === "UserRejectedRequestError";
    wrongChain ||= current.name === "ChainMismatchError" || current.name === "SwitchChainError";
    reverted ||= current.code === 3 || current.name === "TransactionRevertedError";
    rpc ||= current.name === "HttpRequestError" || current.name === "TimeoutError"
      || current.name === "RpcRequestError" || current.name === "InternalRpcError";
    value = current.cause;
  }
  // Viem also wraps generic -32603 wallet errors as ContractFunctionRevertedError.
  // That name alone does not establish an EVM revert.
  const reason = rejected ? "wallet_rejected" : wrongChain ? "wrong_chain"
    : reverted || errorSelector ? "contract_reverted" : rpc ? "rpc_error" : "unknown";
  return { reason, ...(errorCode !== undefined ? { errorCode } : {}), ...(errorSelector ? { errorSelector } : {}) };
}

function emit(reporter: Reporter, event: ClientDiagnostic) {
  try { reporter(event); } catch { /* Including instrumentation injected by tests. */ }
}

export function swapFailureOutcome(error: unknown, submitted?: string | boolean): "failed" | "reverted" | "unconfirmed" {
  if ((error as { name?: string } | null)?.name === "WalletBatchFailedError") return "failed";
  return submitted
    ? diagnosticReason(error) === "contract_reverted" ? "reverted" : "unconfirmed"
    : "failed";
}

/** In-memory identity for one quote observation, never an identity for a wallet. */
export function createQuoteDiagnostics(reporter: Reporter = reportClientDiagnostic) {
  let previous = "";
  let previousContext = "";
  let attemptId: string | undefined;
  let started = 0;
  return {
    get id() { return attemptId; },
    observe(context: DiagnosticContext | undefined, status: string | undefined) {
      if (!context || !status || status === "idle") { previous = ""; previousContext = ""; attemptId = undefined; return; }
      const contextKey = JSON.stringify(context);
      const key = JSON.stringify([context, status]);
      if (key === previous) return;
      if (status === "loading" || !attemptId || contextKey !== previousContext) {
        attemptId = newAttemptId(); started = performance.now();
      }
      previousContext = contextKey;
      previous = key;
      if (status === "success" || status === "failed") emit(reporter, { ...context, operation: "quote",
        outcome: status === "success" ? "succeeded" : "failed", attemptId,
        durationMs: Math.round(performance.now() - started), ...(status === "failed" ? { reason: "unknown" as const } : {}),
      });
    },
  };
}

export function createSwapDiagnostics(context: DiagnosticContext, quoteId?: string, reporter: Reporter = reportClientDiagnostic) {
  const attemptId = newAttemptId();
  const started = performance.now();
  let transactionHash: string | undefined;
  let submitted = false;
  const record = (event: ClientDiagnostic) => emit(reporter, { ...context, quoteId, attemptId,
    operation: "swap", durationMs: Math.round(performance.now() - started), transactionHash, ...event });
  record({ outcome: "started" });
  return {
    walletStep(walletStep: ClientDiagnostic["walletStep"]) { record({ operation: "wallet", outcome: "requested", walletStep }); },
    submitted(hash?: string) { submitted = true; transactionHash = hash; record({ outcome: "submitted" }); },
    confirmed(hash?: string) { if (hash) transactionHash = hash; record({ outcome: "succeeded" }); },
    failed(error: unknown) {
      record({ outcome: swapFailureOutcome(error, submitted), ...diagnosticFailure(error) });
    },
  };
}
