import { getAddress, type Address } from "viem";
import { targetChainId } from "../config/chain.ts";

export const EXPECTED_CHAIN_ID = targetChainId;

export const WRONG_CHAIN_ERROR = `Switch your wallet to chain ${EXPECTED_CHAIN_ID} before continuing.`;

export function assertExpectedChainId(chainId: number | undefined): asserts chainId is number {
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(WRONG_CHAIN_ERROR);
  }
}

export type ChainAwareWalletClient = {
  getChainId: () => Promise<number>;
};

export type AccountAwareWalletClient = {
  account?: { address: Address };
  getAddresses: () => Promise<readonly Address[]>;
};

export async function assertWalletOnExpectedChain(
  walletClient: ChainAwareWalletClient | null | undefined
) {
  if (!walletClient) {
    throw new Error("Wallet client is unavailable.");
  }

  const liveChainId = await walletClient.getChainId();
  assertExpectedChainId(liveChainId);
  return liveChainId;
}

/** Re-read the connector account and bind the subsequent write to the displayed holder. */
export async function assertWalletOnExpectedAccount(
  walletClient: AccountAwareWalletClient | null | undefined,
  expectedAccount: Address
) {
  if (!walletClient) {
    throw new Error("Wallet client is unavailable.");
  }

  const expected = getAddress(expectedAccount);
  const configured = walletClient.account?.address;
  const liveAddresses = await walletClient.getAddresses();
  const live = liveAddresses[0];
  if (
    !configured ||
    !live ||
    getAddress(configured) !== expected ||
    getAddress(live) !== expected
  ) {
    throw new Error("Wallet account changed. Refresh recovery shares before continuing.");
  }
  return expected;
}
