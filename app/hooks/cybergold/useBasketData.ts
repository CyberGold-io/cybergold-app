"use client";

import { useMemo } from "react";
import { useProtocolFact, useProtocolFacts } from "@/app/hooks/protocol/useProtocolFacts";
import { basketFromFacts, bigintFact } from "@/app/utils/protocolFacts";

export function useBasketData() {
  const query = useProtocolFacts();
  const reference = useProtocolFact(facts => facts.reference);
  const basketFacts = query.data?.basket;
  const data = useMemo(() => basketFacts ? basketFromFacts({ basket: basketFacts }) : undefined, [basketFacts]);
  const fieldError = useMemo(() => {
    if (!query.data) return null;
    const basket = query.data.basket;
    const reads = [basket.assets, basket.targetsPpm, basket.goldRefGramsFp18, basket.cygldPerUnitFp18,
      ...basket.metadata.flatMap(row => [row.decimals, row.name, row.symbol])];
    return reads.some(read => read.status === "failure") ? new Error("Basket contract read unavailable.") : null;
  }, [query.data]);
  const basket = { data, error: query.error ?? fieldError, isError: query.isError || fieldError !== null,
    isFetched: query.isFetched, isLoading: query.isLoading, refetch: query.refetch };
  const cygldRefGrams = { ...reference, data: bigintFact(query.data?.reference) };
  return { basket, cygldRefGrams };
}
