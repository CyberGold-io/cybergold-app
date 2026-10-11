import type { Address, Hex } from "viem";
import type { components } from "../contracts/backend/http";
import type { SafeTxPayload } from "./governanceSafeContracts";

export function safeExecutionRequest(address: Address, payload: SafeTxPayload, executor: Address,
  executorNonce: number, signatures: Hex): components["schemas"]["SafeExecutionRequest"] {
  return { address, to: payload.to, value: payload.value.toString(), data: payload.data, operation: payload.operation,
    safeTxGas: payload.safeTxGas.toString(), baseGas: payload.baseGas.toString(), gasPrice: payload.gasPrice.toString(),
    gasToken: payload.gasToken, refundReceiver: payload.refundReceiver, executor,
    executorNonce: executorNonce.toString(), signatures };
}

export async function simulateSafeExecution(address: Address, payload: SafeTxPayload, executor: Address,
  executorNonce: number, signatures: Hex, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl("/api/governance/safe-execution", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(safeExecutionRequest(address, payload, executor, executorNonce, signatures)),
  });
  if (!response.ok) throw new Error("Safe execution simulation is temporarily unavailable.");
  const result: components["schemas"]["SafeExecution"] = await response.json();
  return result.success;
}
