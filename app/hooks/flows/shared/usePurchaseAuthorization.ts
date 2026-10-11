"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { assertObservedAddress, requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback } from "react";
import { usePublicClient, useSignTypedData, useWalletClient, useWriteContract } from "wagmi";
import { zeroHash, type Address } from "viem";
import { erc20Abi } from "@/app/contracts/erc20";

import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { buildDeadline, PERMIT_DEADLINE_TTL_SEC } from "@/app/utils/swapPolicy";
import { collectWalletApproval, type WalletSwapBatch, type WalletTypedData } from "@/app/utils/walletBatch";
import { signWalletTypedDataGroup } from "@/app/utils/walletTypedData";
import { fetchTokenPermit, signedTokenPermit, tokenApprovalGasLimit, tokenPermitTypedData,
  tokenPurchaseApprovalAmounts, tokenPurchaseAuthorization, walletTypedDataUnavailable, type TokenPermitContext } from "@/app/utils/tokenPermit";
import { waitForAppTransactionReceipt } from "@/app/utils/receiptWait";
import { usePermit2Transfer } from "./usePermit2Transfer";
import type { CygldPermit, PermitBatchTransferFromWithSignature, TokenPermissions, WalletConfirmationTracker } from "./types";

export type BasketIssueInput = { token: Address; maximumInputAmount: bigint; authorization: 0 | 1 | 2; permit: CygldPermit };
export const emptyTokenPermit: CygldPermit = { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
export const emptyPermit2: PermitBatchTransferFromWithSignature = { permit: { permitted: [], nonce: 0n, deadline: 0n }, signature: "0x" };

/** Shares exact native permissions and the compact Permit2 subset across purchase inputs. */
export function usePurchaseAuthorization() {
  const { addresses, tokenAddresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const publicClient = usePublicClient({ chainId: EXPECTED_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { preparePermit2Authorization } = usePermit2Transfer();

  const preparePurchaseAuthorization = useCallback(async ({ owner, permitted, nativePermitsInstalled,
    singlePermit2 = false, walletBatch, walletConfirmationTracker, spender = requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
  }: { owner: Address; permitted: readonly TokenPermissions[]; nativePermitsInstalled: boolean | (() => Promise<boolean>);
    singlePermit2?: boolean; spender?: Address; walletBatch?: WalletSwapBatch; walletConfirmationTracker?: WalletConfirmationTracker }) => {
    const allowances: bigint[] = [];
    let installed = typeof nativePermitsInstalled === "boolean" ? nativePermitsInstalled : undefined;
    const inputs: BasketIssueInput[] = [];
    const native: { index: number; domain: NonNullable<TokenPermitContext["authorization"]["domain"]>; nonce: bigint }[] = [];
    const p2Permissions: TokenPermissions[] = [];
    for (const [index, permission] of permitted.entries()) {
      const input: BasketIssueInput = { token: permission.token, maximumInputAmount: permission.amount, authorization: 0, permit: emptyTokenPermit };
      inputs.push(input);
      if (permission.amount === 0n) { allowances.push(0n); continue; }
      const context = await fetchTokenPermit(permission.token, owner);
      assertObservedAddress(context.spender, spender, "Token permit spender");
      if (installed === undefined && typeof nativePermitsInstalled === "function" && context.allowance.status === "success"
        && BigInt(context.allowance.value) < permission.amount && context.authorization.kind === "erc2612"
        && context.authorization.confidence === "qualified" && context.authorization.domain) installed = await nativePermitsInstalled();
      const choice = tokenPurchaseAuthorization(context, permission.amount, installed ?? false);
      allowances.push(choice.allowance);
      if (choice.kind === "permit") {
        input.authorization = 1;
        native.push({ index, domain: choice.domain, nonce: choice.nonce });
      } else if (choice.kind === "approval") {
        input.authorization = 2;
        p2Permissions.push(permission);
      }
    }
    const beforeApprovals = walletBatch?.approvals.length ?? 0;
    const p2 = p2Permissions.length ? await preparePermit2Authorization({ owner, permitted: p2Permissions,
      single: singlePermit2, spender, walletBatch, walletConfirmationTracker, signatureCount: native.length + 1 }) : undefined;
    if (!p2) await assertWalletOnExpectedChain(walletClient);
    const deadline = buildDeadline(PERMIT_DEADLINE_TTL_SEC);
    const requests: WalletTypedData[] = native.map(({ index, domain, nonce }) => tokenPermitTypedData(owner,
      spender, inputs[index].maximumInputAmount, deadline, domain, nonce));
    if (p2) requests.push(p2.request);
    if (!p2) walletConfirmationTracker?.setTotal(requests.length + 1);
    let signatures;
    try {
      signatures = await signWalletTypedDataGroup(requests, signTypedDataAsync, walletBatch, walletConfirmationTracker);
    } catch (error) {
      if (!walletTypedDataUnavailable(error)) throw error;
      await p2?.waitForApproval();
      // Only the established unsupported-format outcome selects exact approval.
      // A partial SDK signature group is never replayed or replaced.
      if (walletBatch) walletBatch.approvals.splice(beforeApprovals);
      const approvals = inputs.flatMap((input, index) => tokenPurchaseApprovalAmounts(input.token,
        allowances[index], input.maximumInputAmount, tokenAddresses.USDT).map(amount => ({ token: input.token, amount })));
      walletConfirmationTracker?.setTotal((walletBatch?.mode === "atomic" ? 0 : approvals.length) + 1);
      for (const { token, amount } of approvals) {
        if (walletBatch) { collectWalletApproval(walletBatch, token, spender, amount); continue; }
        if (!publicClient) throw new Error("Public client is unavailable");
        const gas = await tokenApprovalGasLimit(owner, token, amount);
        await assertWalletOnExpectedChain(walletClient);
        walletConfirmationTracker?.requestNext("approval", "Token approval");
        const hash = await writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: owner, address: token,
          abi: erc20Abi, functionName: "approve", args: [spender, amount], gas });
        const receipt = await waitForAppTransactionReceipt(publicClient, { hash });
        if (receipt.status === "reverted") {
          const reverted = new Error("Token approval reverted"); reverted.name = "TransactionRevertedError"; throw reverted;
        }
      }
      return { inputs: inputs.map(input => ({ ...input, authorization: 0 as const })), permit2: emptyPermit2 };
    }
    native.forEach(({ index }, signatureIndex) => {
      inputs[index].permit = signedTokenPermit(inputs[index].maximumInputAmount, deadline, signatures[signatureIndex]);
    });
    return { inputs, permit2: p2 ? await p2.complete(signatures.at(-1)!) : emptyPermit2 };
  }, [publicClient, walletClient, signTypedDataAsync, writeContractAsync, preparePermit2Authorization, HELPERS_DIAMOND_ADDRESS, tokenAddresses]);

  return { preparePurchaseAuthorization };
}
