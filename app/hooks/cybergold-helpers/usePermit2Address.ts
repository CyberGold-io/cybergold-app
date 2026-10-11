import { useHelpersRouterFacts } from "../useHelpersRouterFacts";
import { permit2FromFacts } from "../../utils/helpersRouterFacts";

export function usePermit2Address() {
  return useHelpersRouterFacts(permit2FromFacts, { staleTime: 5 * 60_000 });
}
