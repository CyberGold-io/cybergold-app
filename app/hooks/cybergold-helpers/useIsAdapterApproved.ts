import { isAddress, zeroAddress, type Address } from "viem";
import { useHelpersRouterFacts } from "../useHelpersRouterFacts";
import { adapterApprovalFromFacts } from "../../utils/helpersRouterFacts";

export function useIsAdapterApproved(adapter?: Address) {
  const validAdapter = adapter && isAddress(adapter) && adapter !== zeroAddress ? adapter : undefined;
  return useHelpersRouterFacts(facts => adapterApprovalFromFacts(facts, validAdapter),
    { enabled: Boolean(validAdapter) });
}
