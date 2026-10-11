"use client";

import { useQuery } from "@tanstack/react-query";
import { targetChain } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { transactionFeesQuery, transactionFeeValues } from "@/app/utils/transactionFees";

export function useTransactionFees(enabled: boolean) {
  const generation = useSandboxForkGeneration();
  return useQuery({
    ...transactionFeesQuery(targetChain.id, generation),
    select: transactionFeeValues,
    enabled,
  });
}
