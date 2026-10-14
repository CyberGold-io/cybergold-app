import { diagnosticReferences, quoteDiagnostics, retainDiagnosticReferences, retainQuoteDiagnostics, type DiagnosticReferences } from "./diagnosticReferences.ts";

export const quoteErrorKeys = {
  "insufficient-protocol-supply": "quoteProtocolSupplyExceeded",
  "issuance-cap-exceeded": "quoteIssuanceCapExceeded",
  "rpc-rate-limit": "quoteRpcRateLimit",
  "rpc-timeout": "quoteRpcTimeout",
  "rpc-unavailable": "quoteRpcUnavailable",
  "rpc-access-denied": "quoteRpcAccessDenied",
  "quote-timeout": "quoteTimedOut",
  "quote-no-route": "quoteNoRoute",
  "quote-contract-reverted": "quoteContractRejected",
  "quote-unavailable": "quoteUnexpectedError",
  "quote-service-unavailable": "quoteServiceUnavailable",
  "quote-stream-interrupted": "quoteStreamInterrupted",
  "quote-invalid-input": "quoteInvalidInput",
  "quote-request-limit": "quoteRequestLimit",
} as const;
type Code = keyof typeof quoteErrorKeys;

export class QuotePreviewError extends Error {
  readonly code: Code;
  constructor(code: Code, message: string, references?: DiagnosticReferences, diagnostics?: unknown) {
    super(message); this.code = code; retainDiagnosticReferences(this, references ?? {}); retainQuoteDiagnostics(this, diagnostics);
  }
}

export function knownQuoteError(value: unknown): QuotePreviewError | undefined {
  const code = (value as { code?: unknown } | null)?.code;
  if (code === "insufficient-protocol-supply") return new QuotePreviewError(code, "The redemption amount exceeds available CYGLD supply.", diagnosticReferences(value), quoteDiagnostics(value));
  if (code === "issuance-cap-exceeded") return new QuotePreviewError(code, "The issuance amount exceeds the CYGLD supply limit.", diagnosticReferences(value), quoteDiagnostics(value));
  if (typeof code === "string" && Object.hasOwn(quoteErrorKeys, code)) return new QuotePreviewError(code as Code, code, diagnosticReferences(value), quoteDiagnostics(value));
}

export function quoteErrorMessage(error: Error, translate: (key: typeof quoteErrorKeys[Code]) => string) {
  return translate(error instanceof QuotePreviewError ? quoteErrorKeys[error.code] : "quoteUnexpectedError");
}

export async function quoteResponseError(response: Response): Promise<QuotePreviewError> {
  const body = await response.json().catch(() => null);
  retainDiagnosticReferences(body, { requestId: response.headers.get("X-CyberGold-Request-Id") ?? undefined });
  const known = knownQuoteError(body);
  if (known) return known;
  const code = response.status === 400 ? "quote-invalid-input" : response.status === 429 ? "quote-request-limit"
    : response.status === 504 ? "quote-timeout" : "quote-service-unavailable";
  return new QuotePreviewError(code, code, diagnosticReferences(body), quoteDiagnostics(body));
}
