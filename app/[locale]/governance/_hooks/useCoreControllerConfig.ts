"use client";

import { useGovernanceCoreFacts } from "@/app/hooks/useGovernanceCoreFacts";
import { coreConfigFromFacts } from "@/app/utils/governanceCoreFacts";

export type { CoreControllerConfigState } from "@/app/utils/governanceCoreFacts";

export function useCoreControllerConfig() {
  return useGovernanceCoreFacts(coreConfigFromFacts);
}
