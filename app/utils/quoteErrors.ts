import { diagnosticReferences, quoteDiagnostics, retainDiagnosticReferences, retainQuoteDiagnostics, type DiagnosticReferences } from "./diagnosticReferences.ts";

export const quoteErrorKeys = {
  "insufficient-protocol-supply": "quoteProtocolSupplyExceeded",
  "issuance-cap-exceeded": "quoteIssuanceCapExceeded",
  "redemption-supply-exceeded": "quoteRedemptionSupplyExceeded",
  "redemption-capacity-exceeded": "quoteRedemptionCapacityExceeded",
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

export type QuoteConstraint = {
  kind: 'issuance-cap' | 'redemption-supply' | 'redemption-capacity';
  quantity?: 'gross-cygld-mint' | 'gross-cygld-input' | 'core-output-minima';
  limitKind?: 'maximum-total-supply' | 'effective-supply-cap';
  requestedRaw?: string; availableRaw?: string; currentSupplyRaw?: string; limitRaw?: string;
};
/** Preserve only the producer's structured capacity facts, never upstream text. */
export function safeQuoteConstraint(value: unknown): QuoteConstraint | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, unknown>;
  if (!['issuance-cap', 'redemption-supply', 'redemption-capacity'].includes(String(raw.kind))) return;
  const result: QuoteConstraint = { kind: raw.kind as QuoteConstraint['kind'] };
  if (['gross-cygld-mint', 'gross-cygld-input', 'core-output-minima'].includes(String(raw.quantity))) result.quantity = raw.quantity as QuoteConstraint['quantity'];
  if (['maximum-total-supply', 'effective-supply-cap'].includes(String(raw.limitKind))) result.limitKind = raw.limitKind as QuoteConstraint['limitKind'];
  for (const field of ['requestedRaw', 'availableRaw', 'currentSupplyRaw', 'limitRaw'] as const) {
    const number = raw[field];
    if (typeof number === 'string' && /^(0|[1-9][0-9]*)$/.test(number) && number.length <= 78 && BigInt(number) < 2n ** 256n) result[field] = number;
  }
  return result;
}

export class QuotePreviewError extends Error {
  readonly code: Code;
  readonly constraint?: QuoteConstraint;
  constructor(code: Code, message: string, references?: DiagnosticReferences, diagnostics?: unknown, constraint?: unknown) {
    super(message); this.code = code; retainDiagnosticReferences(this, references ?? {}); retainQuoteDiagnostics(this, diagnostics);
    const observed = safeQuoteConstraint(constraint); if (observed) this.constraint = observed;
  }
}

export function knownQuoteError(value: unknown): QuotePreviewError | undefined {
  const code = (value as { code?: unknown } | null)?.code;
  const constraint = safeQuoteConstraint((value as { constraint?: unknown } | null)?.constraint);
  const messages: Partial<Record<Code, string>> = {
    'insufficient-protocol-supply': 'The Core redemption exceeds available supply or redemption capacity.',
    'issuance-cap-exceeded': 'The issuance amount exceeds the CYGLD supply limit.',
    'redemption-supply-exceeded': 'The CYGLD input exceeds the available supply for redemption.',
    'redemption-capacity-exceeded': 'The requested Core outputs exceed the available redemption capacity.',
  };
  if (typeof code === "string" && Object.hasOwn(quoteErrorKeys, code)) return new QuotePreviewError(code as Code, messages[code as Code] ?? code, diagnosticReferences(value), quoteDiagnostics(value), constraint);
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
