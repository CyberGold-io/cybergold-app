import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import type { components } from "../contracts/backend/http";
import type { TokenType } from "../types";

export type ProtocolConfiguration = components["schemas"]["ProtocolConfiguration"];
export type ProtocolAddresses = { core?: Address; helpers?: Address; governance?: Address;
  staking?: Address; safe?: Address; adapter?: Address };
export type ProtocolTokenAddresses = Partial<Record<"CYGLD" | "XAUT" | "PAXG" | "USDT" | "USDC" | "WETH", Address>>;
export type ProtocolDeployment = Pick<ProtocolAddresses, "core" | "helpers" | "adapter">;

function address(raw: string | null | undefined): Address | undefined {
  return raw && isAddress(raw) && raw.toLowerCase() !== zeroAddress ? getAddress(raw) : undefined;
}

export const emptyProtocolConfiguration = { addresses: {} as ProtocolAddresses,
  tokens: [] as TokenType[], tokenAddresses: {} as ProtocolTokenAddresses, identity: "unavailable" };

export function protocolConfigurationValues(configuration: ProtocolConfiguration) {
  const c = configuration.contracts;
  const addresses: ProtocolAddresses = { core: address(c.core), helpers: address(c.helpers),
    governance: address(c.governance), staking: address(c.staking), safe: address(c.safe),
    adapter: address(c.uniswapAdapter) };
  const tokens: TokenType[] = configuration.tokens.flatMap<TokenType>(token => {
    if (token.type === "native") return [{ ...token }];
    const target = address(token.address);
    return target ? [{ ...token, address: target }] : [];
  });
  const tokenAddresses = Object.fromEntries(tokens.flatMap(token => token.type === "erc20"
    ? [[token.symbol.toUpperCase(), token.address]] : [])) as ProtocolTokenAddresses;
  return { addresses, tokens, tokenAddresses,
    identity: JSON.stringify([configuration.chainId, addresses.core, addresses.helpers, addresses.adapter, configuration.universalExactInput?.adapter, configuration.universalExactInput?.encoding, configuration.sandboxForkGeneration]) };
}

export async function fetchProtocolConfiguration(chainId: number, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<ProtocolConfiguration> {
  const response = await fetchImpl("/api/protocol/config", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Protocol configuration is temporarily unavailable.");
  const result: ProtocolConfiguration = await response.json();
  // Wallet operations already bind to the selected chain. A configuration
  // response from another profile cannot supply their contract addresses.
  if (result.chainId !== chainId) throw new Error("Protocol configuration belongs to another chain.");
  return result;
}

export function requireProtocolAddress(target: Address | undefined, label: string): Address {
  if (!target) throw new Error(`${label} address is temporarily unavailable.`);
  return target;
}

/** A refresh may change the Backend target while a wallet flow keeps its original target. */
export function assertObservedAddress(observed: string | null | undefined, target: Address, label: string) {
  if (observed?.toLowerCase() !== target.toLowerCase()) throw new Error(`${label} changed while preparing the operation.`);
}
