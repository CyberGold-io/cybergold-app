import { environmentConfig, environmentSetting, requiredEnvironmentSetting } from "./environmentValidation.ts";

// Explicit public env reads are required for Next.js browser substitution.
export const publicEnv = environmentConfig({
  NEXT_PUBLIC_APP_ORIGIN: environmentSetting("NEXT_PUBLIC_APP_ORIGIN", () => process.env.NEXT_PUBLIC_APP_ORIGIN, "url"),
  NEXT_PUBLIC_BLOCK_EXPLORER_URL: environmentSetting("NEXT_PUBLIC_BLOCK_EXPLORER_URL", () => process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL, "url"),
  NEXT_PUBLIC_CHAIN_ID: requiredEnvironmentSetting("NEXT_PUBLIC_CHAIN_ID", () => process.env.NEXT_PUBLIC_CHAIN_ID, "positiveInteger"),
  NEXT_PUBLIC_CHAIN_NAME: requiredEnvironmentSetting("NEXT_PUBLIC_CHAIN_NAME", () => process.env.NEXT_PUBLIC_CHAIN_NAME, "text"),
  NEXT_PUBLIC_CYBERGOLD_APP_COMMIT: environmentSetting("NEXT_PUBLIC_CYBERGOLD_APP_COMMIT", () => process.env.NEXT_PUBLIC_CYBERGOLD_APP_COMMIT, "text"),
  NEXT_PUBLIC_FORK_FAUCET_ENABLED: environmentSetting("NEXT_PUBLIC_FORK_FAUCET_ENABLED", () => process.env.NEXT_PUBLIC_FORK_FAUCET_ENABLED, "flag"),
  NEXT_PUBLIC_QUOTE_POOL_LIQUIDITY_CACHE_TTL_MS: environmentSetting("NEXT_PUBLIC_QUOTE_POOL_LIQUIDITY_CACHE_TTL_MS", () => process.env.NEXT_PUBLIC_QUOTE_POOL_LIQUIDITY_CACHE_TTL_MS, "integer"),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: environmentSetting("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", () => process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, "text"),
  NEXT_PUBLIC_WALLET_RPC_URL: environmentSetting("NEXT_PUBLIC_WALLET_RPC_URL", () => process.env.NEXT_PUBLIC_WALLET_RPC_URL, "url"),
});

export function validatePublicEnvironment() {
  Object.values(publicEnv);
}
