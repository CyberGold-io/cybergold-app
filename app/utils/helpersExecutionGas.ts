import type { Address } from "viem";
import type { components } from "../contracts/backend/http";
import { assertObservedAddress } from "./protocolConfiguration.ts";

export type HelpersExecutionOperation = components["schemas"]["HelpersExecutionRequest"]["operation"];

export async function estimateHelpersExecutionGas(owner: Address, operation: HelpersExecutionOperation,
  args: readonly unknown[], value?: bigint, fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
  expectedHelpers?: Address): Promise<bigint> {
  const response = await fetchImpl("/api/transaction/helpers-execution", {
    method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, operation, args, ...(value === undefined ? {} : { value: value.toString() }) },
      (_, item) => typeof item === "bigint" ? item.toString() : item),
  });
  if (!response.ok) throw new Error("Swap execution fee simulation is temporarily unavailable.");
  const result: components["schemas"]["HelpersExecution"] = await response.json();
  if (expectedHelpers) assertObservedAddress(result.helpers, expectedHelpers, "Helpers simulation target");
  return BigInt(result.gas);
}
