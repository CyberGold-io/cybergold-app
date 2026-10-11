"use client";

import type { Address } from "viem";
import type { BasketComponent } from "@/app/types";
import type { FlowNetworkFeeEstimateHandlers } from "./shared/types";
import { useRedeemToTokenExactInFlow } from "./useRedeemToTokenExactInFlow";

type Params = { enabled: boolean; outputToken?: Address; quoteOutputToken?: Address;
  targetOut: bigint; basketComponents: readonly BasketComponent[]; isNativeOutputToken?: boolean;
} & FlowNetworkFeeEstimateHandlers;

/** Same exact-in executor and aggregate minimum; the backend owns the bounded solver. */
export function useRedeemToTokenMinOutFlow(params: Params) {
  const flow = useRedeemToTokenExactInFlow({ ...params, grossCygldIn: 0n,
    aggregateMinimumAmountOut: params.targetOut });
  return { ...flow, grossCygldInToDisplay: flow.quoteStatus === "failed" ? undefined : flow.displayGrossCygldIn,
    isAmountTooSmall: flow.execution?.grossCygldIn === 0n };
}
