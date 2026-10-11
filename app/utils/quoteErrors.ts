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
  constructor(code: Code, message: string) { super(message); this.code = code; }
}

export function knownQuoteError(value: unknown): QuotePreviewError | undefined {
  const code = (value as { code?: unknown } | null)?.code;
  if (code === "insufficient-protocol-supply") return new QuotePreviewError(code, "The redemption amount exceeds available CYGLD supply.");
  if (code === "issuance-cap-exceeded") return new QuotePreviewError(code, "The issuance amount exceeds the CYGLD supply limit.");
  if (typeof code === "string" && Object.hasOwn(quoteErrorKeys, code)) return new QuotePreviewError(code as Code, code);
}

export function quoteErrorMessage(error: Error, translate: (key: typeof quoteErrorKeys[Code]) => string) {
  return translate(error instanceof QuotePreviewError ? quoteErrorKeys[error.code] : "quoteUnexpectedError");
}

export async function quoteResponseError(response: Response): Promise<QuotePreviewError> {
  const known = knownQuoteError(await response.json().catch(() => null));
  if (known) return known;
  const code = response.status === 400 ? "quote-invalid-input" : response.status === 429 ? "quote-request-limit"
    : response.status === 504 ? "quote-timeout" : "quote-service-unavailable";
  return new QuotePreviewError(code, code);
}
