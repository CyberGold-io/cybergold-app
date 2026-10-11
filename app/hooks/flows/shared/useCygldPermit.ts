"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { assertObservedAddress, requireProtocolAddress, type ProtocolDeployment } from "@/app/utils/protocolConfiguration";


import { useCallback } from "react";
import { usePublicClient, useSignTypedData, useWalletClient, useWriteContract } from "wagmi";
import { type Address } from "viem";
import { erc20Abi } from "@/app/contracts/erc20";
import { corePermitSigningFields, fetchCorePermit } from "@/app/utils/corePermit";
import { fetchTokenPermit, signedTokenPermit, tokenApprovalGasLimit, tokenPermitTypedData, walletTypedDataUnavailable } from "@/app/utils/tokenPermit";
import { collectWalletApproval, type WalletSwapBatch } from "@/app/utils/walletBatch";
import { signWalletTypedDataGroup } from "@/app/utils/walletTypedData";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";

import { buildDeadline, PERMIT_DEADLINE_TTL_SEC } from "@/app/utils/swapPolicy";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import type { CygldPermit, WalletConfirmationTracker } from "./types";

export function useCygldPermit() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const signCygldPermit = useCallback(async ({ owner, value, deadline, walletBatch, walletConfirmationTracker, deployment,
  }: { owner: Address; value: bigint; deadline?: bigint; deployment?: ProtocolDeployment; walletBatch?: WalletSwapBatch;
    walletConfirmationTracker?: WalletConfirmationTracker }): Promise<CygldPermit | undefined> => {
    const cygldAddress = requireProtocolAddress(deployment?.core ?? addresses.core, "Core");
    const helpers = requireProtocolAddress(deployment?.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers");
    const authorization = await fetchTokenPermit(cygldAddress, owner);
    assertObservedAddress(authorization.spender, helpers, "CYGLD permit spender");
    if (authorization.allowance.status !== "success") throw new Error("Token allowance is temporarily unavailable.");
    if (BigInt(authorization.allowance.value) >= value) { walletConfirmationTracker?.setTotal(1); return undefined; }
    // Core's native permit contract is already canonical; retain its established domain producer.
    const context = await fetchCorePermit(owner);
    assertObservedAddress(context.domain.verifyingContract, cygldAddress, "CYGLD permit domain");
    assertObservedAddress(context.spender, helpers, "Core permit spender");
    const { domain, spender, nonce } = corePermitSigningFields(context, EXPECTED_CHAIN_ID, cygldAddress, helpers);
    await assertWalletOnExpectedChain(walletClient);
    const permitDeadline = deadline ?? buildDeadline(PERMIT_DEADLINE_TTL_SEC);
    walletConfirmationTracker?.setTotal(2);
    try {
      const [signature] = await signWalletTypedDataGroup([tokenPermitTypedData(owner, spender, value, permitDeadline, domain, nonce)],
        signTypedDataAsync, walletBatch, walletConfirmationTracker);
      return signedTokenPermit(value, permitDeadline, signature);
    } catch (error) {
      if (!walletTypedDataUnavailable(error)) throw error;
      walletConfirmationTracker?.setTotal(walletBatch?.mode === "atomic" ? 1 : 2);
      if (walletBatch) { collectWalletApproval(walletBatch, cygldAddress, helpers, value); return undefined; }
      if (!publicClient) throw new Error("Public client is unavailable");
      const gas = await tokenApprovalGasLimit(owner, cygldAddress, value);
      await assertWalletOnExpectedChain(walletClient);
      walletConfirmationTracker?.requestNext("approval", "Token approval");
      const hash = await writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: owner, address: cygldAddress,
        abi: erc20Abi, functionName: "approve", args: [helpers, value], gas });
      const receipt = await waitForAppTransactionReceipt(publicClient, { hash });
      if (receipt.status === "reverted") {
        const reverted = new Error("Token approval reverted"); reverted.name = "TransactionRevertedError"; throw reverted;
      }
      return undefined;
    }
  }, [walletClient, publicClient, signTypedDataAsync, writeContractAsync, addresses, HELPERS_DIAMOND_ADDRESS]);
  return { signCygldPermit };
}
