import {
  decodeAbiParameters,
  toEventHash,
  type Address,
  type Hex,
} from "viem";
import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";

export type PauseAction = "pause" | "unpause";
export type HistoryStatus = "executed" | "failed" | "cancelled";

export type SafeTxPayload = {
  to: Address;
  value: bigint;
  data: Hex;
  operation: number;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
};

export const PAUSE_SELECTOR = "0x8456cb59" as Hex;
export const UNPAUSE_SELECTOR = "0x3f4ba83a" as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export const PAUSABLE_CONTROL_ABI = [
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const SAFE_ABI = [
  {
    type: "function",
    name: "getOwners",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getThreshold",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonce",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTransactionHash",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execTransaction",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "payable",
  },
] as const;

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const SAFE_EXECUTION_SUCCESS_TOPIC = toEventHash("ExecutionSuccess(bytes32,uint256)") as Hex;
const SAFE_EXECUTION_FAILURE_TOPIC = toEventHash("ExecutionFailure(bytes32,uint256)") as Hex;

function safeBigInt(value: string | number | bigint | undefined, fallback = 0n) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function pauseControlAction(tx: SafeServicePendingTx): PauseAction | undefined {
  const selector = tx.data.slice(0, 10).toLowerCase();
  if (selector === PAUSE_SELECTOR.toLowerCase()) return "pause";
  if (selector === UNPAUSE_SELECTOR.toLowerCase()) return "unpause";
  return undefined;
}

export function buildSafeRejectionPayload(safeAddress: Address, nonce: bigint): SafeTxPayload {
  return {
    to: safeAddress,
    value: 0n,
    data: "0x",
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce,
  };
}

export function isSafeRejectionPayload(payload: SafeTxPayload, safeAddress: Address) {
  return (
    payload.to.toLowerCase() === safeAddress.toLowerCase() &&
    payload.value === 0n &&
    payload.data === "0x" &&
    payload.operation === 0 &&
    payload.safeTxGas === 0n &&
    payload.baseGas === 0n &&
    payload.gasPrice === 0n &&
    payload.gasToken.toLowerCase() === ZERO_ADDRESS.toLowerCase() &&
    payload.refundReceiver.toLowerCase() === ZERO_ADDRESS.toLowerCase()
  );
}

export function isSafeRejectionTransaction(tx: SafeServicePendingTx, safeAddress: Address) {
  return isSafeRejectionPayload(toSafeTxPayload(tx), safeAddress);
}

export function formatTimestamp(value: string | undefined, locale: string) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

export function statusFromSafeExecutionLogs(
  logs: Array<{ address: Address; data: Hex; topics: readonly Hex[] }>,
  safeAddress: Address,
  safeTxHash: Hex
): HistoryStatus | undefined {
  const expectedSafeTxHash = safeTxHash.toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== safeAddress.toLowerCase()) continue;
    if (log.topics.length === 0) continue;
    const eventTopic = log.topics[0].toLowerCase();
    if (
      eventTopic !== SAFE_EXECUTION_SUCCESS_TOPIC.toLowerCase() &&
      eventTopic !== SAFE_EXECUTION_FAILURE_TOPIC.toLowerCase()
    ) {
      continue;
    }

    try {
      let eventSafeTxHash: string | undefined;
      if (log.topics.length >= 2 && /^0x[a-fA-F0-9]{64}$/.test(log.topics[1])) {
        eventSafeTxHash = log.topics[1].toLowerCase();
      } else if (log.data.length >= 130) {
        const [decodedSafeTxHash] = decodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], log.data);
        eventSafeTxHash = decodedSafeTxHash.toLowerCase();
      }

      if (eventSafeTxHash !== expectedSafeTxHash) continue;
      return eventTopic === SAFE_EXECUTION_FAILURE_TOPIC.toLowerCase() ? "failed" : "executed";
    } catch {
      // Ignore unrelated Safe logs in the same receipt.
    }
  }
  return undefined;
}

export function toSafeTxPayload(tx: SafeServicePendingTx): SafeTxPayload {
  return {
    to: tx.to,
    value: safeBigInt(tx.value),
    data: tx.data,
    operation: tx.operation,
    safeTxGas: safeBigInt(tx.safeTxGas),
    baseGas: safeBigInt(tx.baseGas),
    gasPrice: safeBigInt(tx.gasPrice),
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: BigInt(tx.nonce),
  };
}
