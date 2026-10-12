import type { components } from "../contracts/backend/http";
import { diagnosticAttemptId, diagnosticReferences, type DiagnosticReferences } from "./diagnosticReferences.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

export type DiagnosticStage = "quote" | "balance" | "network" | "authorization" | "preparation" | "simulation" | "submission" | "confirmation";
export type ClientDiagnostic = components["schemas"]["ClientDiagnostic"];
export type DiagnosticContext = Omit<ClientDiagnostic, "operation" | "outcome" | "reason" | "walletStep" | "durationMs" | "transactionHash" | "errorCode" | "errorSelector">;
type Reporter = (event: ClientDiagnostic) => void;

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
export function diagnosticFailure(error: unknown): Pick<ClientDiagnostic, "reason" | "errorCode" | "errorSelector" | "errorClassification" | "requestId" | "correlationId"> {
  // Error text and generic `data` can contain signatures, URLs and calldata.
  const seen = new Set<unknown>();
  let errorCode: number | undefined;
  let errorSelector: string | undefined;
  let rejected = false;
  let wrongChain = false;
  let reverted = false;
  let rpc = false;
  if (error instanceof QuotePreviewError) {
    rpc = error.code.startsWith("rpc-") || ["quote-service-unavailable", "quote-timeout", "quote-stream-interrupted"].includes(error.code);
    reverted = error.code === "quote-contract-reverted";
  }
  let value = error;
  let references: DiagnosticReferences = {};
  while (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    references = { ...diagnosticReferences(value), ...references };
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
  const { requestId, correlationId } = references;
  return { reason, ...(errorCode !== undefined ? { errorCode } : {}), ...(errorSelector ? { errorSelector } : {}),
    ...(error instanceof QuotePreviewError ? { errorClassification: error.code } : {}),
    ...(requestId ? { requestId } : {}), ...(correlationId ? { correlationId } : {}) };
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
    observe(context: DiagnosticContext | undefined, status: string | undefined, error?: unknown, metadata?: DiagnosticReferences) {
      if (!context || !status || status === "idle") { previous = ""; previousContext = ""; attemptId = undefined; return; }
      const contextKey = JSON.stringify(context);
      const refs = { ...metadata, ...diagnosticReferences(error) };
      const key = JSON.stringify([context, status, refs]);
      if (key === previous) return;
      if (status === "loading" || !attemptId || contextKey !== previousContext) {
        attemptId = refs.attemptId ?? diagnosticAttemptId(); started = performance.now();
      }
      if (refs.attemptId) attemptId = refs.attemptId;
      previousContext = contextKey;
      previous = key;
      if (status === "success" || status === "failed") emit(reporter, { ...context, ...refs, stage: "quote", operation: "quote",
        outcome: status === "success" ? "succeeded" : "failed", attemptId,
        durationMs: Math.round(performance.now() - started), ...(status === "failed" ? diagnosticFailure(error) : {}),
      });
    },
  };
}

export function createSwapDiagnostics(context: DiagnosticContext, quoteId?: string, reporter: Reporter = reportClientDiagnostic) {
  const attemptId = diagnosticAttemptId();
  const started = performance.now();
  let transactionHash: string | undefined;
  let submitted = false;
  let stage: DiagnosticStage = "preparation";
  const record = (event: ClientDiagnostic) => emit(reporter, { ...context, quoteId, attemptId,
    operation: "swap", durationMs: Math.round(performance.now() - started), transactionHash, stage, ...event });
  record({ outcome: "started" });
  return {
    get id() { return attemptId; },
    stage(value: DiagnosticStage) { stage = value; },
    walletStep(walletStep: ClientDiagnostic["walletStep"]) { stage = walletStep === "transaction" ? "submission" : "authorization"; record({ operation: "wallet", outcome: "requested", walletStep }); },
    submitted(hash?: string) { submitted = true; transactionHash = hash; stage = "submission"; record({ outcome: "submitted" }); stage = "confirmation"; },
    confirmed(hash?: string) { if (hash) transactionHash = hash; record({ outcome: "succeeded" }); },
    failed(error: unknown) {
      record({ outcome: swapFailureOutcome(error, submitted), ...diagnosticFailure(error) });
    },
  };
}
