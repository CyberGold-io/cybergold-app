import { publicEnv } from "../config/publicEnvironment.ts";
import { targetChainId } from "../config/chain.ts";

export function getEtherscanBaseUrl(chainId?: number) {
  const normalizedChainId = chainId ?? targetChainId;
  const configuredExplorerUrl = publicEnv.NEXT_PUBLIC_BLOCK_EXPLORER_URL?.replace(/\/$/, "");

  if (normalizedChainId === 1) {
    return "https://etherscan.io";
  }

  return configuredExplorerUrl;
}
