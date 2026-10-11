"use client";

import { useHelpersRouterFacts } from "@/app/hooks/useHelpersRouterFacts";
import { helpersConfigFromFacts } from "@/app/utils/helpersRouterFacts";

export type { HelpersRouterConfigState } from "@/app/utils/helpersRouterFacts";

export function useHelpersRouterConfig() {
  return useHelpersRouterFacts(helpersConfigFromFacts);
}
