"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback, useRef } from "react";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { usePublicClient, useSignTypedData, useWalletClient, useWriteContract } from "wagmi";
import { getTypesForEIP712Domain, maxUint256, type Address, type Hex } from "viem";

import { erc20Abi } from "@/app/contracts/erc20";
import { usePermit2Address } from "@/app/hooks/cybergold-helpers/usePermit2Address";

import { getPermit2Nonce } from "@/app/utils/permit2/nonce";
import {
  requirePermit2ContractAddress,
  verifyPermit2ContractAddress,
} from "@/app/utils/permit2/verifyAddress";
import { getTokensNeedingPermit2Approval } from "@/app/utils/tokensApproval";
import { permit2ApprovalGasLimit } from "@/app/utils/permit2ApprovalGas";
import { buildDeadline, PERMIT_DEADLINE_TTL_SEC } from "@/app/utils/swapPolicy";
import { targetChainId } from "@/app/config/chain";
import { assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { collectWalletApproval, type WalletSwapBatch, type WalletTypedData } from "@/app/utils/walletBatch";
import { observeApprovalConfirmation, preparePermitWithPendingApproval } from "@/app/utils/pendingApproval";
import { tokenPurchaseApprovalAmounts } from "@/app/utils/tokenPermit";
import { signWalletTypedDataGroup } from "@/app/utils/walletTypedData";
import type {
  PermitBatchTransferFromWithSignature,
  PermitTransferFromWithSignature,
  TokenPermissions,
  WalletConfirmationTracker,
} from "./types";

export function usePermit2Transfer() {
  const { addresses, tokenAddresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { data: walletClient } = useWalletClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { data: permit2Address, isError: isPermit2AddressError } = usePermit2Address();
  const nextPermit2NonceFloorRef = useRef<bigint | undefined>(undefined);

  // Verify that the Permit2 address has been loaded from the contract.

  const requirePermit2Address = useCallback((): Address => {
    if (isPermit2AddressError) {
      throw new Error("Permit2 address is unavailable");
    }

    return requirePermit2ContractAddress(permit2Address);
  }, [isPermit2AddressError, permit2Address]);

  const verifyPermit2Address = useCallback(async (): Promise<Address> => {
    return verifyPermit2ContractAddress({
      expectedPermit2Address: requirePermit2Address(),
    });
  }, [requirePermit2Address]);

  const approvePermit2Token = useCallback(
    async (token: Address, owner: Address, amount = maxUint256) => {
      const [permit2Address, gas] = await Promise.all([
        verifyPermit2Address(), permit2ApprovalGasLimit(owner, token),
      ]);

      await assertWalletOnExpectedChain(walletClient);
      return writeContractAsync({
        chainId: targetChainId,
        account: owner,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [permit2Address, amount],
        gas,
      });
    },
    [verifyPermit2Address, walletClient, writeContractAsync]
  );

  const reservePermit2Nonce = useCallback(
    async (owner: Address) => {
      requirePermit2Address();
      const onchainNonce = await getPermit2Nonce({ owner });

      const reservedNonce =
        nextPermit2NonceFloorRef.current !== undefined &&
        nextPermit2NonceFloorRef.current > onchainNonce
          ? nextPermit2NonceFloorRef.current
          : onchainNonce;

      nextPermit2NonceFloorRef.current = reservedNonce + 1n;
      return reservedNonce;
    },
    [requirePermit2Address]
  );

  const approvePermittedTokens = useCallback(
    async ({
      owner,
      permitted,
      walletConfirmationTracker,
      trailingConfirmationCount = 0,
      walletBatch,
    }: {
      owner: Address;
      permitted: readonly TokenPermissions[];
      walletConfirmationTracker?: WalletConfirmationTracker;
      trailingConfirmationCount?: number;
      walletBatch?: WalletSwapBatch;
    }) => {
      if (!publicClient) {
        throw new Error("Public client is unavailable");
      }

      const configuredPermit2 = requirePermit2Address();
      const tokensNeedingPermit2 = await getTokensNeedingPermit2Approval({
        owner,
        permitted: [...permitted],
      });
      const approvals = tokensNeedingPermit2.flatMap(({ token, amount, allowance }) =>
        tokenPurchaseApprovalAmounts(token, allowance, amount, tokenAddresses.USDT).map(value => ({ token, amount: value === 0n ? 0n : maxUint256 })));

      walletConfirmationTracker?.setTotal(
        (walletBatch && walletBatch.mode !== "requests" ? 0 : approvals.length) + trailingConfirmationCount
      );

      if (walletBatch) {
        for (const { token, amount } of approvals) collectWalletApproval(walletBatch, token, configuredPermit2, amount);
        return { confirmation: observeApprovalConfirmation(Promise.resolve()) };
      }

      for (const [index, { token, amount }] of approvals.entries()) {
        walletConfirmationTracker?.requestNext("approval", "Token approval");
        const hash = await approvePermit2Token(token, owner, amount);
        const confirmation = waitForAppTransactionReceipt(publicClient, { hash }).then(receipt => {
          if (receipt.status === "reverted") {
            const error = new Error("Token approval reverted");
            error.name = "TransactionRevertedError";
            throw error;
          }
        });
        if (index === approvals.length - 1) {
          return { confirmation: observeApprovalConfirmation(confirmation) };
        }
        await confirmation;
      }
      return { confirmation: observeApprovalConfirmation(Promise.resolve()) };
    },
    [approvePermit2Token, publicClient, requirePermit2Address, tokenAddresses]
  );

  const preparePermit2Authorization = useCallback(async ({
    owner, permitted, spender = requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"), deadline,
    walletConfirmationTracker, walletBatch, single = false, signatureCount = 1,
  }: { owner: Address; permitted: readonly TokenPermissions[]; spender?: Address; deadline?: bigint;
    walletConfirmationTracker?: WalletConfirmationTracker; walletBatch?: WalletSwapBatch; single?: boolean; signatureCount?: number }) => {
    if (!permitted.length) throw new Error("Permit2 batch requires at least one permitted token");
    const { confirmation } = await approvePermittedTokens({ owner, permitted, walletConfirmationTracker,
      walletBatch, trailingConfirmationCount: signatureCount + 1 });
    const [nonce, verifiedPermit2Address] = await Promise.all([reservePermit2Nonce(owner), verifyPermit2Address()]);
    await assertWalletOnExpectedChain(walletClient);
    const permitDeadline = deadline ?? buildDeadline(PERMIT_DEADLINE_TTL_SEC);
    const permit = { permitted: [...permitted], nonce, deadline: permitDeadline };
    const domain = { name: "Permit2", chainId: targetChainId, verifyingContract: verifiedPermit2Address };
    const primaryType = single ? "PermitTransferFrom" : "PermitBatchTransferFrom";
    const request: WalletTypedData = { account: owner, domain, primaryType,
      types: { EIP712Domain: getTypesForEIP712Domain({ domain }), PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ], PermitBatchTransferFrom: [
        { name: "permitted", type: "TokenPermissions[]" },
        { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ], TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }] },
      message: { permitted: single ? permitted[0] : permitted, spender, nonce, deadline: permitDeadline } };
    return { request, permit,
      waitForApproval: () => preparePermitWithPendingApproval(confirmation, async () => undefined),
      complete: (signature: Hex) => preparePermitWithPendingApproval(confirmation, async () => ({ permit, signature })) };
  }, [approvePermittedTokens, reservePermit2Nonce, verifyPermit2Address, walletClient, HELPERS_DIAMOND_ADDRESS]);

  const prepareSinglePermit2 = useCallback(async ({ owner, permitToken, permitAmount,
    spender, deadline, walletConfirmationTracker, walletBatch,
  }: { owner: Address; permitToken?: Address; permitAmount: bigint; spender?: Address; deadline?: bigint;
    walletConfirmationTracker?: WalletConfirmationTracker; walletBatch?: WalletSwapBatch;
  }): Promise<PermitTransferFromWithSignature | undefined> => {
    if (!permitToken || permitAmount <= 0n) return undefined;
    const prepared = await preparePermit2Authorization({ owner, permitted: [{ token: permitToken, amount: permitAmount }],
      spender, deadline, walletConfirmationTracker, walletBatch, single: true });
    const [signature] = await signWalletTypedDataGroup([prepared.request], signTypedDataAsync, walletBatch, walletConfirmationTracker);
    const signed = await prepared.complete(signature);
    return { ...signed.permit, permitted: signed.permit.permitted[0], signature };
  }, [preparePermit2Authorization, signTypedDataAsync]);

  const prepareBatchPermit2 = useCallback(async ({ owner, permitted, spender, deadline, walletConfirmationTracker, walletBatch,
  }: { owner: Address; permitted: readonly TokenPermissions[]; spender?: Address; deadline?: bigint;
    walletConfirmationTracker?: WalletConfirmationTracker; walletBatch?: WalletSwapBatch;
  }): Promise<PermitBatchTransferFromWithSignature> => {
    const prepared = await preparePermit2Authorization({ owner, permitted, spender, deadline, walletConfirmationTracker, walletBatch });
    const [signature] = await signWalletTypedDataGroup([prepared.request], signTypedDataAsync, walletBatch, walletConfirmationTracker);
    return prepared.complete(signature);
  }, [preparePermit2Authorization, signTypedDataAsync]);

  return {
    approvePermit2Token,
    prepareSinglePermit2,
    prepareBatchPermit2,
    preparePermit2Authorization,
    reservePermit2Nonce,
  };
}
