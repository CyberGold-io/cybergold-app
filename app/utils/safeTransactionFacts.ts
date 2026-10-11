import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";
import type { SafeTxPayload } from "./governanceSafeContracts";

export async function fetchSafeNonce(address: Address, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<bigint> {
  const response = await fetchImpl(`/api/governance/safe-nonce?${new URLSearchParams({ address })}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Safe transaction observations are temporarily unavailable.");
  const result: components["schemas"]["SafeNonce"] = await response.json();
  return BigInt(result.nonce);
}

export function safeTransactionHashRequest(address: Address, payload: SafeTxPayload): components["schemas"]["SafeTransactionHashRequest"] {
  return { address, to: payload.to, value: payload.value.toString(), data: payload.data, operation: payload.operation,
    safeTxGas: payload.safeTxGas.toString(), baseGas: payload.baseGas.toString(), gasPrice: payload.gasPrice.toString(),
    gasToken: payload.gasToken, refundReceiver: payload.refundReceiver, nonce: payload.nonce.toString() };
}

export async function fetchSafeTransactionHash(address: Address, payload: SafeTxPayload, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Hex> {
  const response = await fetchImpl("/api/governance/safe-transaction-hash", {
    method: "POST", signal, cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(safeTransactionHashRequest(address, payload)),
  });
  if (!response.ok) throw new Error("Safe transaction observations are temporarily unavailable.");
  const result: components["schemas"]["SafeTransactionHash"] = await response.json();
  return result.safeTxHash as Hex;
}
