"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, getAddress, isAddress, type Hex } from "viem";

export type SafeServicePendingConfirmation = {
  owner: Address;
  signature: Hex;
};

export type SafeServicePendingTx = {
  safeTxHash: Hex;
  to: Address;
  value: string;
  data: Hex;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
  isExecuted: boolean;
  isSuccessful?: boolean;
  confirmationsRequired?: number;
  confirmations: SafeServicePendingConfirmation[];
  submissionDate?: string;
  executionDate?: string;
  transactionHash?: Hex;
  origin?: string;
};

export type SafeServiceInfo = {
  address: Address;
  nonce?: number;
  threshold?: number;
  owners?: Address[];
};

export type SafeExecutionStatus = {
  safeTxHash: Hex;
  status: "executed" | "failed";
  transactionHash: Hex;
  blockNumber: string;
  executionDate: string;
};

type SafeAction =
  | "safe-info"
  | "pending-transactions"
  | "executed-transactions"
  | "propose-transaction"
  | "confirm-transaction"
  | "transaction-details";

type SafeApiEnvelope = {
  error?: string;
  details?: unknown;
};

const SAFE_READ_RETRY_COUNT = 2;
const SAFE_READ_REFETCH_INTERVAL_MS = 30_000;
const SAFE_READ_MAX_IMMEDIATE_RETRY_AFTER_MS = 5_000;

export class SafeApiRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "SafeApiRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value || !/^\d{1,4}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds >= 1 && seconds <= 3_600 ? seconds * 1_000 : undefined;
}

export const shouldRetrySafeRead = (failureCount: number, error: unknown) => {
  if (
    failureCount >= SAFE_READ_RETRY_COUNT ||
    !(error instanceof SafeApiRequestError) ||
    (error.status !== 0 && error.status !== 429 && error.status < 500)
  ) {
    return false;
  }

  return !(
    error.status === 429 &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs > SAFE_READ_MAX_IMMEDIATE_RETRY_AFTER_MS
  );
};

export const safeReadRetryDelay = (attemptIndex: number, error: unknown) =>
  error instanceof SafeApiRequestError && error.retryAfterMs !== undefined
    ? Math.min(error.retryAfterMs, SAFE_READ_MAX_IMMEDIATE_RETRY_AFTER_MS)
    : Math.min(500 * 2 ** attemptIndex, 2_000);

export const safeReadRefetchInterval = (query: { state: { error: unknown } }) => {
  const error = query.state.error;
  return error instanceof SafeApiRequestError && error.retryAfterMs !== undefined
    ? Math.max(SAFE_READ_REFETCH_INTERVAL_MS, error.retryAfterMs)
    : SAFE_READ_REFETCH_INTERVAL_MS;
};

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) {
    return undefined;
  }
  return getAddress(value);
}

function normalizeHex(value: unknown): Hex | undefined {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return undefined;
  }
  return value as Hex;
}

function normalizeBigIntLike(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizePendingTransaction(value: unknown): SafeServicePendingTx | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const safeTxHash = normalizeHex(row.safeTxHash);
  const to = normalizeAddress(row.to);
  const data = normalizeHex(row.data) ?? "0x";
  const valueString = normalizeBigIntLike(row.value) ?? "0";
  const operation = typeof row.operation === "number" ? row.operation : Number(row.operation ?? 0);
  const safeTxGas = normalizeBigIntLike(row.safeTxGas) ?? "0";
  const baseGas = normalizeBigIntLike(row.baseGas) ?? "0";
  const gasPrice = normalizeBigIntLike(row.gasPrice) ?? "0";
  const gasToken = normalizeAddress(row.gasToken) ?? "0x0000000000000000000000000000000000000000";
  const refundReceiver =
    normalizeAddress(row.refundReceiver) ?? "0x0000000000000000000000000000000000000000";
  const nonce = typeof row.nonce === "number" ? row.nonce : Number(row.nonce ?? NaN);
  const isExecuted = Boolean(row.isExecuted);
  const isSuccessful = typeof row.isSuccessful === "boolean" ? row.isSuccessful : undefined;
  const confirmationsRequired =
    typeof row.confirmationsRequired === "number"
      ? row.confirmationsRequired
      : row.confirmationsRequired !== undefined
        ? Number(row.confirmationsRequired)
        : undefined;

  if (!safeTxHash || !to || !Number.isFinite(nonce)) {
    return undefined;
  }

  const confirmations = Array.isArray(row.confirmations)
    ? row.confirmations
        .map((item) => {
          if (!item || typeof item !== "object") return undefined;
          const entry = item as Record<string, unknown>;
          const owner = normalizeAddress(entry.owner);
          const signature = normalizeHex(entry.signature);
          if (!owner || !signature) return undefined;
          return { owner, signature } satisfies SafeServicePendingConfirmation;
        })
        .filter((item): item is SafeServicePendingConfirmation => !!item)
    : [];

  return {
    safeTxHash,
    to,
    value: valueString,
    data,
    operation: Number.isFinite(operation) ? operation : 0,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    nonce,
    isExecuted,
    isSuccessful,
    confirmationsRequired: Number.isFinite(confirmationsRequired ?? NaN)
      ? confirmationsRequired
      : undefined,
    confirmations,
    submissionDate: typeof row.submissionDate === "string" ? row.submissionDate : undefined,
    executionDate: typeof row.executionDate === "string" ? row.executionDate : undefined,
    transactionHash: normalizeHex(row.transactionHash),
    origin: typeof row.origin === "string" ? row.origin : undefined,
  };
}

export async function callSafeApi<T = unknown>(
  action: SafeAction,
  payload: Record<string, unknown>
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/safe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
  } catch {
    throw new SafeApiRequestError("Safe API request failed.", 0);
  }

  let data: (T & SafeApiEnvelope) | null = null;
  try {
    data = (await response.json()) as T & SafeApiEnvelope;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : `Safe API request failed with status ${response.status}`;
    throw new SafeApiRequestError(
      message,
      response.status,
      parseRetryAfterMs(response.headers.get("retry-after"))
    );
  }

  return data as T;
}

export async function fetchSafePendingTransactions(safeAddress: Address) {
  const raw = await callSafeApi<Record<string, unknown>>("pending-transactions", { safeAddress });
  const rows = Array.isArray(raw.results) ? raw.results : [];
  return rows
    .map((row) => normalizePendingTransaction(row))
    .filter((row): row is SafeServicePendingTx => !!row);
}

export function useSafeServiceInfo(safeAddress?: Address, enabled = true) {
  return useQuery({
    queryKey: ["safe-service-info", safeAddress],
    enabled: enabled && !!safeAddress,
    staleTime: 20_000,
    retry: shouldRetrySafeRead,
    retryDelay: safeReadRetryDelay,
    refetchInterval: safeReadRefetchInterval,
    queryFn: async () => {
      const raw = await callSafeApi<Record<string, unknown>>("safe-info", { safeAddress });
      const normalizedAddress = normalizeAddress(raw.address ?? safeAddress);
      if (!normalizedAddress) {
        throw new Error("Safe service returned invalid safe address.");
      }

      const nonce = typeof raw.nonce === "number" ? raw.nonce : Number(raw.nonce ?? NaN);
      const threshold =
        typeof raw.threshold === "number" ? raw.threshold : Number(raw.threshold ?? NaN);
      const owners = Array.isArray(raw.owners)
        ? raw.owners.map((owner) => normalizeAddress(owner)).filter((owner): owner is Address => !!owner)
        : undefined;

      return {
        address: normalizedAddress,
        nonce: Number.isFinite(nonce) ? nonce : undefined,
        threshold: Number.isFinite(threshold) ? threshold : undefined,
        owners,
      } satisfies SafeServiceInfo;
    },
  });
}

export function useSafePendingTransactions(safeAddress?: Address, enabled = true) {
  return useQuery({
    queryKey: ["safe-pending-transactions", safeAddress],
    enabled: enabled && !!safeAddress,
    staleTime: 8_000,
    retry: shouldRetrySafeRead,
    retryDelay: safeReadRetryDelay,
    refetchInterval: safeReadRefetchInterval,
    queryFn: () => fetchSafePendingTransactions(safeAddress!),
  });
}

export function useSafeExecutedTransactions(safeAddress?: Address, enabled = true) {
  return useQuery({
    queryKey: ["safe-executed-transactions", safeAddress],
    enabled: enabled && !!safeAddress,
    staleTime: 10_000,
    retry: shouldRetrySafeRead,
    retryDelay: safeReadRetryDelay,
    refetchInterval: safeReadRefetchInterval,
    queryFn: async () => {
      const raw = await callSafeApi<Record<string, unknown>>("executed-transactions", { safeAddress });
      const rows = Array.isArray(raw.results) ? raw.results : [];
      return rows
        .map((row) => normalizePendingTransaction(row))
        .filter((row): row is SafeServicePendingTx => !!row);
    },
  });
}

export function useSafeExecutionStatuses(safeAddress?: Address, safeTxHashes: string[] = [], enabled = true) {
  return useQuery({
    queryKey: ["safe-execution-statuses", safeAddress, safeTxHashes],
    enabled: enabled && !!safeAddress && safeTxHashes.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch("/api/safe/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ safeAddress, safeTxHashes }),
        cache: "no-store",
      });

      let payload: { results?: unknown[]; error?: string } | null = null;
      try {
        payload = (await response.json()) as { results?: unknown[]; error?: string };
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? `Safe execution status request failed with status ${response.status}`);
      }

      const rows = Array.isArray(payload?.results) ? payload.results : [];
      return rows
        .map((row) => {
          if (!row || typeof row !== "object") return undefined;
          const value = row as Record<string, unknown>;
          const safeTxHash = normalizeHex(value.safeTxHash);
          const transactionHash = normalizeHex(value.transactionHash);
          const status = value.status === "executed" || value.status === "failed" ? value.status : undefined;
          if (!safeTxHash || !transactionHash || !status) return undefined;
          return {
            safeTxHash,
            status,
            transactionHash,
            blockNumber: typeof value.blockNumber === "string" ? value.blockNumber : String(value.blockNumber ?? ""),
            executionDate: typeof value.executionDate === "string" ? value.executionDate : "",
          } satisfies SafeExecutionStatus;
        })
        .filter((row): row is SafeExecutionStatus => !!row);
    },
  });
}
