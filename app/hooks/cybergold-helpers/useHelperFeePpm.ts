"use client";

import { useProtocolFact } from "@/app/hooks/protocol/useProtocolFacts";

export function useHelperFeePpm() {
  const query = useProtocolFact(facts => facts.fees.helpersPpm);
  return { ...query, data: query.data === undefined ? undefined : BigInt(query.data) };
}
