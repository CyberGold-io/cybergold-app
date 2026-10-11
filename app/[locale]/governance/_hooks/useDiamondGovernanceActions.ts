"use client";

import { useState } from "react";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  encodeFunctionData,
  isAddress,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import {
  usePublicClient,
  useSignTypedData,
  useWalletClient,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useObservedWalletAccount } from "@/app/hooks/useObservedWalletAccount";
import {
  callSafeApi,
  fetchSafePendingTransactions,
} from "@/app/hooks/useSafeTransactionService";
import {
  SAFE_TX_TYPES,
  type SafeTxPayload,
  ZERO_ADDRESS,
} from "@/app/utils/governanceSafeContracts";
import { noArgFunctionName } from "@/app/utils/governanceActionEligibility";
import { fetchSafeNonce, fetchSafeTransactionHash } from "@/app/utils/safeTransactionFacts";
import { fetchPendingTransactionNonce } from "@/app/utils/transactionNonce";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedChain,
} from "@/app/utils/expectedChain";
import type {
  GovernanceActionSpec,
  GovernanceSurfaceSpec,
} from "../_lib/governanceSurfaces";

function actionBusyKey(mode: "direct" | "safe", actionId: string, safeAddress?: Address) {
  return safeAddress ? `${mode}:${actionId}:${safeAddress.toLowerCase()}` : `${mode}:${actionId}`;
}

function noArgActionAbi(action: GovernanceActionSpec) {
  const functionName = noArgFunctionName(action.functionSignature);
  if (!functionName) return undefined;

  return {
    abi: [
      {
        type: "function",
        name: functionName,
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ] as Abi,
    functionName,
  };
}

function surfaceAddress(surface: GovernanceSurfaceSpec) {
  return surface.address && isAddress(surface.address) ? surface.address : undefined;
}

type DirectContractActionRequest = {
  action: GovernanceActionSpec;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  targetAddress?: Address;
};

type SafeContractActionRequest = {
  action: GovernanceActionSpec;
  safeAddress: Address;
  data: Hex;
  targetAddress?: Address;
};

export function useDiamondGovernanceActions(surface: GovernanceSurfaceSpec) {
  const t = useTranslations("Governance");
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { address: connectedAddress } = useObservedWalletAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  const runBusyAction = async (key: string, action: () => Promise<void>) => {
    if (busyActionKey) return;
    setBusyActionKey(key);
    try {
      await action();
    } finally {
      setBusyActionKey(null);
    }
  };

  const getSafeTransactionHash = async (safeAddress: Address, payload: SafeTxPayload) => {
    return await fetchSafeTransactionHash(safeAddress, payload);
  };

  const signSafeTransaction = async (safeAddress: Address, payload: SafeTxPayload) => {
    await assertWalletOnExpectedChain(walletClient);
    return (await signTypedDataAsync({
      domain: {
        chainId: EXPECTED_CHAIN_ID,
        verifyingContract: safeAddress,
      },
      types: SAFE_TX_TYPES,
      primaryType: "SafeTx",
      message: {
        to: payload.to,
        value: payload.value,
        data: payload.data,
        operation: payload.operation,
        safeTxGas: payload.safeTxGas,
        baseGas: payload.baseGas,
        gasPrice: payload.gasPrice,
        gasToken: payload.gasToken,
        refundReceiver: payload.refundReceiver,
        nonce: payload.nonce,
      },
    })) as Hex;
  };

  const submitDirectContractAction = async (request: DirectContractActionRequest) => {
    const target = request.targetAddress ?? surfaceAddress(surface);
    if (!connectedAddress) {
      toast.error(t("pauseConnectWalletError"));
      return;
    }
    if (!target) {
      toast.error(t("pauseTargetUnavailableError"));
      return;
    }
    if (!publicClient) {
      toast.error(t("publicClientUnavailable"));
      return;
    }

    await runBusyAction(actionBusyKey("direct", request.action.id), async () => {
      try {
        await assertWalletOnExpectedChain(walletClient);
        const walletNonce = await fetchPendingTransactionNonce(connectedAddress);
        const hash = await writeContractAsync({
          chainId: EXPECTED_CHAIN_ID,
          account: connectedAddress,
          address: target,
          abi: request.abi,
          functionName: request.functionName as never,
          args: request.args as never,
          nonce: walletNonce,
        });
        await waitForAppTransactionReceipt(publicClient, { hash });
        toast.success(t("diamondDirectActionSuccessToast", { action: request.action.label }));
      } catch (error) {
        toast.error(t("diamondDirectActionErrorToast"), {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const submitSafeContractAction = async (request: SafeContractActionRequest) => {
    const target = request.targetAddress ?? surfaceAddress(surface);
    if (!connectedAddress) {
      toast.error(t("pauseConnectWalletError"));
      return;
    }
    if (!target) {
      toast.error(t("pauseTargetUnavailableError"));
      return;
    }
    if (!publicClient) {
      toast.error(t("publicClientUnavailable"));
      return;
    }

    await runBusyAction(actionBusyKey("safe", request.action.id, request.safeAddress), async () => {
      try {
        await assertWalletOnExpectedChain(walletClient);
        const onchainNonce = await fetchSafeNonce(request.safeAddress);
        const pendingTransactions = await fetchSafePendingTransactions(request.safeAddress);
        const livePendingTransactions = pendingTransactions.filter(
          (tx) => !tx.isExecuted && BigInt(tx.nonce) >= onchainNonce
        );
        const existingTx = livePendingTransactions.find(
          (tx) => tx.to.toLowerCase() === target.toLowerCase() && tx.data.toLowerCase() === request.data.toLowerCase()
        );

        if (existingTx) {
          toast.message(t("diamondActionAlreadyPendingToast", { action: request.action.label }));
          return;
        }

        const maxPendingNonce = livePendingTransactions.reduce((max, tx) => Math.max(max, tx.nonce), -1);
        const nextNonce = BigInt(Math.max(Number(onchainNonce), maxPendingNonce + 1));
        const payload: SafeTxPayload = {
          to: target,
          value: 0n,
          data: request.data,
          operation: 0,
          safeTxGas: 0n,
          baseGas: 0n,
          gasPrice: 0n,
          gasToken: ZERO_ADDRESS,
          refundReceiver: ZERO_ADDRESS,
          nonce: nextNonce,
        };
        const safeTxHash = await getSafeTransactionHash(request.safeAddress, payload);
        const signature = await signSafeTransaction(request.safeAddress, payload);

        await callSafeApi("propose-transaction", {
          safeAddress: request.safeAddress,
          payload: {
            to: payload.to,
            value: payload.value.toString(),
            data: payload.data,
            operation: payload.operation,
            safeTxGas: payload.safeTxGas.toString(),
            baseGas: payload.baseGas.toString(),
            gasPrice: payload.gasPrice.toString(),
            gasToken: payload.gasToken,
            refundReceiver: payload.refundReceiver,
            nonce: Number(payload.nonce),
            contractTransactionHash: safeTxHash,
            sender: connectedAddress,
            signature,
            origin: `CyberGold Governance · ${request.action.label} · ${surface.label}`,
          },
        });

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["safe-pending-transactions", request.safeAddress] }),
          queryClient.invalidateQueries({ queryKey: ["safe-service-info", request.safeAddress] }),
        ]);
        toast.success(t("diamondSafeActionSuccessToast", { action: request.action.label }));
      } catch (error) {
        toast.error(t("diamondSafeActionErrorToast"), {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const submitDirectAction = async (action: GovernanceActionSpec, targetAddress?: Address) => {
    const noArgAction = noArgActionAbi(action);
    if (!noArgAction) {
      toast.error(t("diamondActionFormRequiredToast"));
      return;
    }
    await submitDirectContractAction({
      action,
      abi: noArgAction.abi,
      functionName: noArgAction.functionName,
      args: [],
      targetAddress,
    });
  };

  const submitSafeAction = async (action: GovernanceActionSpec, safeAddress: Address, targetAddress?: Address) => {
    const noArgAction = noArgActionAbi(action);
    if (!noArgAction) {
      toast.error(t("diamondActionFormRequiredToast"));
      return;
    }
    await submitSafeContractAction({
      action,
      safeAddress,
      data: encodeFunctionData({
        abi: noArgAction.abi,
        functionName: noArgAction.functionName,
        args: [],
      }),
      targetAddress,
    });
  };

  return {
    busyActionKey,
    directBusyKey: (actionId: string) => actionBusyKey("direct", actionId),
    safeBusyKey: (actionId: string, safeAddress: Address) => actionBusyKey("safe", actionId, safeAddress),
    submitDirectAction,
    submitDirectContractAction,
    submitSafeAction,
    submitSafeContractAction,
  };
}
