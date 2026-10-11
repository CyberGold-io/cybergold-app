"use client";

import { useProtocolFact } from "@/app/hooks/protocol/useProtocolFacts";

export function useIssuanceFeePpm() {
  const query = useProtocolFact(facts => facts.fees.issuancePpm);
  return { ...query, data: query.data === undefined ? undefined : BigInt(query.data) };
}
