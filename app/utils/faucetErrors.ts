import type { components } from "../contracts/backend/http";

type FaucetCode = components["schemas"]["FaucetErrorCode"];

const messageKeys = {
  DISABLED: "fundDisabled",
  INVALID_ADDRESS: "fundInvalidAddress",
  INVALID_REQUEST: "fundRejected",
  INVALID_REQUEST_ID: "fundRejected",
  INVALID_REQUESTER_IP: "fundRejected",
  UNSUPPORTED_MEDIA_TYPE: "fundRejected",
  REQUEST_TOO_LARGE: "fundRejected",
  REQUEST_REJECTED: "fundRejected",
  CONFIGURATION_ERROR: "fundUnavailable",
  AUTHENTICATION_FAILED: "fundUnavailable",
  BAD_GATEWAY: "fundUnavailable",
  UNAVAILABLE: "fundUnavailable",
  CHAIN_UNAVAILABLE: "fundUnavailable",
  REQUEST_CONFLICT: "fundConflict",
  REQUEST_IN_PROGRESS: "fundInProgress",
  REQUEST_UNCERTAIN: "fundFailedDescription",
  TIMEOUT: "fundFailedDescription",
  INVALID_RESPONSE: "fundFailedDescription",
  RATE_LIMITED: "fundRateLimited",
  ADDRESS_QUOTA_EXHAUSTED: "fundRateLimited",
  IP_QUOTA_EXHAUSTED: "fundRateLimited",
  GLOBAL_QUOTA_EXHAUSTED: "fundRateLimited",
  FUNDING_FAILED: "fundIncomplete",
  EXECUTION_FAILED: "fundIncomplete",
  INTERNAL_ERROR: "fundFailedDescription",
} as const satisfies Record<FaucetCode, string>;

export type FaucetFailureFeedback = {
  messageKey: typeof messageKeys[FaucetCode];
  correlationId?: string;
  retryAfterSeconds?: number;
};

/** Only project known response fields; never display arbitrary upstream text. */
export class FaucetRequestError extends Error {
  readonly status: number;
  readonly code?: FaucetCode;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
  constructor(
    status: number,
    code?: FaucetCode,
    correlationId?: string,
    retryAfterSeconds?: number,
  ) {
    super("Wallet funding could not be confirmed.");
    this.name = "FaucetRequestError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function faucetResponseError(response: Response, payload: unknown): FaucetRequestError {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = !payload || typeof payload !== "object" || Array.isArray(payload) ? "INVALID_RESPONSE"
    : typeof value.code === "string" && Object.hasOwn(messageKeys, value.code)
    ? value.code as FaucetCode : undefined;
  // The producer's reference is a UUID, independent of the funding request ID.
  const correlationId = typeof value.correlationId === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.correlationId)
    ? value.correlationId : undefined;
  const rawRetry = response.headers.get("retry-after") ?? "";
  const retryAfterSeconds = response.status === 429 && /^[0-9]{1,4}$/.test(rawRetry)
    && Number(rawRetry) >= 1 && Number(rawRetry) <= 3600 ? Number(rawRetry) : undefined;
  return new FaucetRequestError(response.status, code, correlationId, retryAfterSeconds);
}

export function faucetFailureFeedback(error: unknown): FaucetFailureFeedback {
  if (!(error instanceof FaucetRequestError)) return { messageKey: "fundFailedDescription" };
  // Retained Backend versions have no code. Their status still establishes
  // quota/rejection/unavailability; a generic 409 cannot establish its outcome.
  const fallback = error.status === 429 ? "fundRateLimited"
    : error.status === 400 || error.status === 413 || error.status === 415 ? "fundRejected"
    : error.status === 403 ? "fundDisabled"
    : error.status === 502 || error.status === 503 ? "fundUnavailable" : "fundFailedDescription";
  return {
    messageKey: error.code ? messageKeys[error.code] : fallback,
    correlationId: error.correlationId,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}
