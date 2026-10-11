import { publicEnv } from "./publicEnvironment.ts";
import type { AddEthereumChainParameter, Chain } from "viem";

function normalizeUrl(url?: string) {
  return url?.replace(/\/$/, "");
}

function canWalletAddRemoteRpcUrl(url: string) {
  const parsed = new URL(url);
  return parsed.protocol === "https:" || (
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  );
}

export const targetChainId = Number(publicEnv.NEXT_PUBLIC_CHAIN_ID);
// These URLs are wallet network suggestions. App data uses fixed Next.js
// adapters and their private backend connection, independently of wallet RPC.
export const targetWalletRpcUrl =
  normalizeUrl(publicEnv.NEXT_PUBLIC_WALLET_RPC_URL) ??
  (targetChainId === 1 ? "https://rpc-mainnet.cybergold.io" :
    targetChainId === 31337 ? "http://127.0.0.1:8545" : "https://rpc-fork.cybergold.io");
export const targetChainName = publicEnv.NEXT_PUBLIC_CHAIN_NAME;
export const targetBlockExplorerUrl = normalizeUrl(publicEnv.NEXT_PUBLIC_BLOCK_EXPLORER_URL);
export const targetChainHex = `0x${targetChainId.toString(16)}`;
export const canAddTargetChainWithCurrentWalletRpcUrl = canWalletAddRemoteRpcUrl(targetWalletRpcUrl);

export const targetChain = {
  id: targetChainId,
  name: targetChainName,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    // Connectors use these URLs when suggesting a network to an external wallet.
    // The App's own read client uses focused product operations.
    default: { http: [targetWalletRpcUrl] },
    public: { http: [targetWalletRpcUrl] },
  },
  ...(targetBlockExplorerUrl
    ? {
        blockExplorers: {
          default: {
            name: `${targetChainName} Explorer`,
            url: targetBlockExplorerUrl,
          },
        },
      }
    : {}),
  testnet: targetChainId !== 1,
} as const satisfies Chain;

export const addEthereumChainParameter = {
  chainName: targetChainName,
  rpcUrls: [targetWalletRpcUrl],
  nativeCurrency: targetChain.nativeCurrency,
  ...(targetBlockExplorerUrl ? { blockExplorerUrls: [targetBlockExplorerUrl] } : {}),
} satisfies Omit<AddEthereumChainParameter, "chainId">;
