"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useCallback, useState } from "react";
import type { Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";

import { transactionFeesQuery, transactionFeeValues } from "@/app/utils/transactionFees";
import { estimateHelpersExecutionGas, type HelpersExecutionOperation } from "@/app/utils/helpersExecutionGas";
import type { NetworkFeeEstimate } from "@/app/types";
import type { FlowNetworkFeeEstimateHandlers } from "./types";

type EstimateSignedContractFeeParams = {
  account?: Address;
  functionName: HelpersExecutionOperation;
  args: readonly unknown[];
  value?: bigint;
  signal?: AbortSignal;
  helpers?: Address;
};

type UseExecutionFeeEstimateParams = FlowNetworkFeeEstimateHandlers & {
  account?: Address;
  enabled?: boolean;
};

export function useExecutionFeeEstimate({
  account,
  enabled = true,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseExecutionFeeEstimateParams = {}) {
  const { addresses } = useProtocolConfiguration();
  const client = useQueryClient();
  const generation = useSandboxForkGeneration();
  const [networkFeeEstimate, setNetworkFeeEstimate] =
    useState<NetworkFeeEstimate | null>(null);
  const [isNetworkFeeEstimateLoading, setIsNetworkFeeEstimateLoading] =
    useState(false);

  const setEstimate = useCallback(
    (estimate: NetworkFeeEstimate | null) => {
      setNetworkFeeEstimate(estimate);
      onNetworkFeeEstimate?.(estimate);
    },
    [onNetworkFeeEstimate]
  );

  const setLoading = useCallback(
    (isLoading: boolean) => {
      setIsNetworkFeeEstimateLoading(isLoading);
      onNetworkFeeEstimateLoadingChange?.(isLoading);
    },
    [onNetworkFeeEstimateLoadingChange]
  );

  const estimateSignedContractFee = useCallback(
    async (params: EstimateSignedContractFeeParams) => {
      const estimateAccount = params.account ?? account;
      if (!estimateAccount || !enabled) {
        return;
      }

      try {
        params.signal?.throwIfAborted();
        setLoading(true);
        const [facts, gas] = await Promise.all([
          client.fetchQuery(transactionFeesQuery(targetChainId, generation)),
          estimateHelpersExecutionGas(estimateAccount, params.functionName, params.args, params.value, fetch, params.signal, params.helpers ?? addresses.helpers),
        ]);
        params.signal?.throwIfAborted();
        const feeData = transactionFeeValues(facts);
        const maxFeePerGas = feeData.maxFeePerGas;
        if (maxFeePerGas <= 0n) {
          return;
        }

        setEstimate({
          wei: gas * maxFeePerGas,
          gas,
          maxFeePerGas,
          mode: "simulated",
        });
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [account, client, enabled, generation, setEstimate, setLoading, addresses]
  );

  return {
    estimateSignedContractFee,
    networkFeeEstimate,
    isNetworkFeeEstimateLoading,
  };
}
